// SPEC2 8: where input becomes an intent, and the one function that applies intents,
// `dispatchIntent(view, intent)`. It builds the `Doc` from the state, calls `reduce`, and
// applies `edit`, the new selection and `typing` as one transaction marked as an intent; then
// `then`, if any, as a second. A refusal is shown as a toast.

import { EditorSelection, EditorState, Facet, Prec, Transaction, type Extension, type StateCommand, type TransactionSpec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { isolateHistory, standardKeymap } from "@codemirror/commands";
import { CLIPBOARD_TYPE } from "../../../contract/src/index.ts";
import { copySelection, diff, reduce, type Doc, type Intent, type Mode, type Sel, type Typing } from "../../../core/src/index.ts";
import { bodyStart } from "./decorations.ts";
import { editorField, intentMark, loadMark, rawTableAt, setModel, setTyping } from "./field.ts";

/** The mode of a view, set by its mode compartment. */
export const modeFacet = Facet.define<Mode, Mode>({ combine: (v) => v[0] ?? "raw" });

export interface DispatchHooks {
  /** Shows a refusal or a note about skipped parts. */
  message(text: string, kind: "info" | "warn"): void;
  /** Told how long a whole intent took (8, "speed"). */
  timed?(ms: number): void;
}

let hooks: DispatchHooks = { message: () => {} };

export function setDispatchHooks(h: DispatchHooks): void {
  hooks = h;
}

/** Shows a message where refusals are shown (the table widget's, for one). */
export function notify(text: string, kind: "info" | "warn" = "warn"): void {
  hooks.message(text, kind);
}

/** The user event of an intent: typing and deletes group in the history by CodeMirror's rules;
 *  every other intent is its own step, isolated on both sides. */
function eventOf(intent: Intent): { userEvent: string; isolate: boolean } {
  switch (intent.type) {
    case "insertText":
      return { userEvent: "input.type", isolate: false };
    case "deleteBackward":
    case "deleteWordBackward":
      return { userEvent: "delete.backward", isolate: false };
    case "deleteForward":
    case "deleteWordForward":
      return { userEvent: "delete.forward", isolate: false };
    default:
      return { userEvent: `input.intent.${intent.type}`, isolate: true };
  }
}

export function docOf(state: EditorState, sel?: Sel): Doc {
  const main = state.selection.main;
  return { text: state.doc.toString(), sel: sel ?? { anchor: main.anchor, head: main.head }, typing: state.field(editorField).typing };
}

/** The transactions of an intent on a state: the intent's own, then `then`'s (8). */
export function intentSpecs(state: EditorState, intent: Intent, o: { sel?: Sel; still?: boolean } = {}): { ok: true; specs: TransactionSpec[]; skipped?: string } | { ok: false; reason: string } {
  const mode = state.facet(modeFacet);
  const r = reduce(docOf(state, o.sel), intent, mode);
  if (!r.ok) return { ok: false, reason: r.reason.endsWith(".") ? r.reason : `${r.reason}.` };
  const { userEvent, isolate } = eventOf(intent);
  const specs: TransactionSpec[] = [
    {
      changes: r.edit ? { from: r.edit.from, to: r.edit.to, insert: r.edit.insert } : undefined,
      selection: EditorSelection.single(r.doc.sel.anchor, r.doc.sel.head),
      effects: [setModel.of(r.model), setTyping.of(r.doc.typing)],
      annotations: [intentMark.of(true), Transaction.userEvent.of(userEvent), ...(isolate && r.edit ? [isolateHistory.of("full")] : [])],
      scrollIntoView: !o.still,
    },
  ];
  if (r.then) {
    // `then` is reduced against the text after the first step.
    const after = state.update(specs[0]).state;
    const r2 = reduce(docOf(after), r.then, mode);
    if (r2.ok && r2.edit) {
      specs.push({
        changes: { from: r2.edit.from, to: r2.edit.to, insert: r2.edit.insert },
        selection: EditorSelection.single(r2.doc.sel.anchor, r2.doc.sel.head),
        effects: [setModel.of(r2.model), setTyping.of(r2.doc.typing)],
        annotations: [intentMark.of(true), Transaction.userEvent.of("input.intent.shortcut"), isolateHistory.of("full")],
        scrollIntoView: true,
      });
    }
  }
  const skipped = r.skipped && r.skipped.count > 0 ? `${r.skipped.count === 1 ? "One part was left as it was" : `${r.skipped.count} parts were left as they were`}: ${r.skipped.reasons.join("; ")}.` : undefined;
  return { ok: true, specs, ...(skipped ? { skipped } : {}) };
}

/**
 * After a change of list at a caret, the browser's own caret is put where the
 * editor's is. A mouse click can leave the browser's caret on the line's element rather than in
 * its text; when the line is then drawn again (a waiting size gone, markup added), the editor
 * reads that stale place back as the start of the line, and what is typed next goes there.
 */
function placeCaret(view: EditorView): void {
  const main = view.state.selection.main;
  if (!main.empty || !view.hasFocus || view.composing) return;
  try {
    const at = view.domAtPos(main.head);
    view.dom.ownerDocument.getSelection()?.collapse(at.node, at.offset);
  } catch {
    // The place is not drawn (off screen): the editor's caret stands as it is.
  }
}

/** Applies an intent; returns false when it was refused. */
export function dispatchIntent(view: EditorView, intent: Intent, o: { sel?: Sel; still?: boolean } = {}): boolean {
  const t0 = performance.now();
  const r = intentSpecs(view.state, intent, o);
  if (!r.ok) {
    hooks.message(r.reason, "warn");
    return false;
  }
  view.dispatch(r.specs[0]);
  if (intent.type === "setList") placeCaret(view);
  if (r.skipped) hooks.message(r.skipped, "info");
  // `then` is applied as its own undo step, against the text now on screen.
  if (r.specs.length > 1) {
    const again = intentSpecs(view.state, { type: "shortcut" });
    if (again.ok) view.dispatch(again.specs[0]);
  }
  hooks.timed?.(performance.now() - t0);
  return true;
}

/** Replaces the whole text as a load ("Take theirs", opening a draft); not an undo step. */
export function loadText(view: EditorView, text: string): void {
  const now = view.state.doc.toString();
  const e = diff(now, text);
  view.dispatch({
    changes: e ? { from: e.from, to: e.to, insert: e.insert } : undefined,
    selection: EditorSelection.single(Math.min(view.state.selection.main.head, text.length)),
    annotations: [loadMark.of(true), Transaction.addToHistory.of(false)],
  });
}

// --- the filter (Rich mode) -----------------------------------------------------------------------

/** Rich mode's filter only drops: a document change passes if it is an intent, an undo or redo,
 *  a load, part of a composition, or inside a table shown as text. */
const richFilter = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  if (tr.annotation(intentMark) || tr.annotation(loadMark)) return tr;
  if (tr.isUserEvent("undo") || tr.isUserEvent("redo") || tr.isUserEvent("input.type.compose")) return tr;
  if (composing.has(tr.startState)) return tr;
  let inside = true;
  tr.changes.iterChangedRanges((a, z) => {
    const t = rawTableAt(tr.startState, a);
    if (!t || z > t[1]) inside = false;
  });
  return inside ? tr : [];
});

// --- caret stops (new in version 2) -----------------------------------------------------------------

/** The nearest caret stop to `pos`: not strictly inside a hidden range, not before the body of a
 *  note with front matter. The lower one on a tie. */
export function nearestStop(state: EditorState, pos: number): number {
  const v = state.field(editorField);
  if (rawTableAt(state, pos)) return pos;
  const body = v.model.note.frontMatter ? bodyStart(v.model) : 0;
  if (pos < body) return Math.min(body, state.doc.length);
  let out = pos;
  v.atomic.between(Math.max(0, pos - 1), pos + 1, (from, to) => {
    if (from < pos && pos < to) {
      out = pos - from <= to - pos ? from : to;
      if (out < body) out = to;
      return false;
    }
    return undefined;
  });
  return out;
}

/**
 * A history command (undo, redo) whose restored selection is kept at caret stops in Rich mode.
 * CodeMirror's history dispatches with `filter: false`, so `caretStops` below never sees it;
 * the selection is moved in a second, selection-only transaction (review, 41).
 */
export function atStops(cmd: StateCommand): StateCommand {
  return ({ state, dispatch }) => {
    let last: Transaction | null = null;
    const ok = cmd({
      state,
      dispatch: (tr) => {
        last = tr;
        dispatch(tr);
      },
    });
    const done = last as Transaction | null;
    if (!ok || !done || done.state.facet(modeFacet) !== "rich") return ok;
    const main = done.state.selection.main;
    const a = nearestStop(done.state, main.anchor);
    const h = nearestStop(done.state, main.head);
    if (a !== main.anchor || h !== main.head) dispatch(done.state.update({ selection: EditorSelection.single(a, h), annotations: Transaction.addToHistory.of(false) }));
    return ok;
  };
}

const caretStops = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection) return tr;
  const state = tr.state;
  const main = tr.newSelection.main;
  const a = nearestStop(state, main.anchor);
  const h = nearestStop(state, main.head);
  if (a === main.anchor && h === main.head) return tr;
  return [tr, { selection: EditorSelection.single(a, h), sequential: true }];
});

// --- composition (8) ---------------------------------------------------------------------------------

/** What was remembered at `compositionstart`. */
export interface Remembered {
  doc: Doc;
  /** The selection's end, and the text's length, then. */
  to: number;
  len: number;
}

export function remember(state: EditorState): Remembered {
  const d = docOf(state);
  return { doc: d, to: Math.max(d.sel.anchor, d.sel.head), len: d.text.length };
}

/**
 * When the composition has ended: the composed text is what now stands between `from` and the
 * point as far from the end of the text as `to` was. `insertText` of it is reduced against the
 * remembered document; one transaction with the user event `input.type.compose` changes the
 * screen into the result (or puts the remembered text back when it is refused), so the history
 * joins it to the composition. When the result is the text on screen, only `typing` and the
 * selection change.
 */
export function compositionSpec(b: Remembered, now: EditorState): { spec: TransactionSpec; refused?: string } | null {
  const text = now.doc.toString();
  const from = Math.min(b.doc.sel.anchor, b.doc.sel.head);
  const composed = text.slice(from, Math.max(from, text.length - (b.len - b.to)));
  const r = reduce(b.doc, { type: "insertText", text: composed }, "rich");
  const target = r.ok ? r.doc.text : b.doc.text;
  const e = diff(text, target);
  const sel = r.ok ? r.doc.sel : b.doc.sel;
  const typing: Typing = r.ok ? r.doc.typing : b.doc.typing;
  if (composed === "" && !e) return null;
  return {
    spec: {
      changes: e ? { from: e.from, to: e.to, insert: e.insert } : undefined,
      selection: EditorSelection.single(sel.anchor, sel.head),
      effects: [setTyping.of(typing), ...(r.ok ? [setModel.of(r.model)] : [])],
      annotations: [intentMark.of(true), ...(e ? [Transaction.userEvent.of("input.type.compose")] : [])],
      scrollIntoView: true,
    },
    ...(r.ok ? {} : { refused: r.reason }),
  };
}

/** States at which a composition is under way (the filter lets CodeMirror's own changes through). */
const composing = new WeakSet<EditorState>();

function composition(): Extension {
  let before: Remembered | null = null;
  let pending = false;
  const finish = (view: EditorView) => {
    const b = before;
    before = null;
    pending = false;
    if (!b) return;
    const r = compositionSpec(b, view.state);
    if (!r) return;
    view.dispatch(r.spec);
    if (r.refused) hooks.message(`${r.refused}.`, "warn");
  };
  return [
    EditorView.domEventHandlers({
      compositionstart(_e, view) {
        if (view.state.facet(modeFacet) !== "rich" || rawTableAt(view.state, view.state.selection.main.head)) return false;
        before = remember(view.state);
        composing.add(view.state);
        return false;
      },
      compositionend(_e, view) {
        if (!before) return false;
        pending = true;
        // When CodeMirror has made its last update for the composition (on Android a frame
        // later), the composed text is read from the document.
        const wait = () => {
          if (!pending) return;
          if (view.composing) requestAnimationFrame(wait);
          else setTimeout(() => pending && finish(view), 0);
        };
        requestAnimationFrame(wait);
        return false;
      },
    }),
    EditorView.updateListener.of((u) => {
      if (before && u.view.composing) composing.add(u.state);
      if (before && !pending) for (const tr of u.transactions) if (tr.docChanged) composing.add(tr.state);
    }),
  ];
}

// --- keys, typing, clipboard (8) -------------------------------------------------------------------------

function inRawTable(state: EditorState): boolean {
  const s = state.selection.main;
  const t = rawTableAt(state, s.from);
  return t !== null && s.to <= t[1];
}

export interface RichInputOptions {
  /** Image files pasted or dropped: upload, then `insertPhoto`. */
  onFiles(view: EditorView, files: File[]): void;
  /** Leaving the editor for anything but the toolbar or the header clears `typing`. */
  keepsTyping(target: Element | null): boolean;
}

/** The extensions that turn input into intents in Rich mode. */
export function richInput(o: RichInputOptions): Extension[] {
  const k = (intent: Intent) => (view: EditorView) => (inRawTable(view.state) ? false : (dispatchIntent(view, intent), true));
  return [
    richFilter,
    caretStops,
    EditorState.allowMultipleSelections.of(false),
    EditorView.inputHandler.of((view, from, to, text) => {
      if (view.composing || inRawTable(view.state)) return false;
      dispatchIntent(view, { type: "insertText", text }, { sel: { anchor: from, head: to } });
      return true;
    }),
    Prec.highest(
      keymap.of([
        { key: "Enter", run: k({ type: "enter" }) },
        { key: "Shift-Enter", run: k({ type: "lineBreak" }) },
        { key: "Backspace", run: k({ type: "deleteBackward" }) },
        { key: "Delete", run: k({ type: "deleteForward" }) },
        { key: "Mod-Backspace", run: k({ type: "deleteWordBackward" }) },
        { key: "Alt-Backspace", run: k({ type: "deleteWordBackward" }) },
        { key: "Mod-Delete", run: k({ type: "deleteWordForward" }) },
        // Tab leaves the editor in Rich mode.
        { key: "Tab", run: (v) => !inRawTable(v.state) && false },
        { key: "Shift-Tab", run: () => false },
      ]),
    ),
    keymap.of(standardKeymap),
    EditorView.domEventHandlers({
      copy(e, view) {
        return !inRawTable(view.state) && copyEvent(view, e, false);
      },
      cut(e, view) {
        return !inRawTable(view.state) && copyEvent(view, e, true);
      },
      paste(e, view) {
        const data = e.clipboardData;
        if (!data) return false;
        const files = Array.from(data.files ?? []).filter((f) => f.type.startsWith("image/"));
        if (files.length) {
          e.preventDefault();
          o.onFiles(view, files);
          return true;
        }
        if (inRawTable(view.state)) return false;
        e.preventDefault();
        const md = data.getData(CLIPBOARD_TYPE);
        dispatchIntent(view, { type: "paste", plain: data.getData("text/plain"), markdown: md || null });
        return true;
      },
      drop(e, view) {
        const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
        if (files.length) {
          e.preventDefault();
          o.onFiles(view, files);
          return true;
        }
        // Dropped text is refused in Rich mode, but not inside a table shown as text, where
        // CodeMirror's own editing applies (8; review, 29).
        const at = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (at !== null && rawTableAt(view.state, at)) return false;
        e.preventDefault();
        return true;
      },
      blur(e, view) {
        if (o.keepsTyping(e.relatedTarget as Element | null)) return false;
        const v = view.state.field(editorField);
        if (v.typing.marks.length) setTimeout(() => view.dispatch({ effects: setTyping.of({ marks: [] }) }), 0);
        return false;
      },
    }),
    composition(),
  ];
}

function copyEvent(view: EditorView, e: ClipboardEvent, cut: boolean): boolean {
  const sel = view.state.selection.main;
  if (sel.empty || !e.clipboardData) return false;
  const c = copySelection(view.state.doc.toString(), sel.from, sel.to);
  e.preventDefault();
  e.clipboardData.setData("text/plain", c.plain);
  if (c.markdown !== null) e.clipboardData.setData(CLIPBOARD_TYPE, c.markdown);
  if (cut) dispatchIntent(view, { type: "cut" });
  return true;
}

/** Raw mode: file paste and drop still upload photos. */
export function rawInput(o: Pick<RichInputOptions, "onFiles">): Extension[] {
  return [
    EditorView.domEventHandlers({
      paste(e, view) {
        const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
        if (!files.length) return false;
        e.preventDefault();
        o.onFiles(view, files);
        return true;
      },
      drop(e, view) {
        const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
        if (!files.length) return false;
        e.preventDefault();
        o.onFiles(view, files);
        return true;
      },
    }),
  ];
}
