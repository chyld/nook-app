// SPEC2 8: one CodeMirror view per open note. Its document is `load().text`. Rich and Raw are
// the same view with different extensions, so switching keeps the caret, selection, scroll
// position and undo history.

import { Compartment, EditorSelection, EditorState, Prec, type Extension, type StateCommand } from "@codemirror/state";
import { drawSelection, EditorView, keymap, placeholder, type KeyBinding } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { finalTable, linkAt, type Mode } from "../../../core/src/index.ts";
import { editorField, richOptions, setRich, tableAsText } from "./field.ts";
import { atStops, dispatchIntent, modeFacet, richInput, rawInput, loadText } from "./dispatch.ts";
import type { RichOptions } from "./decorations.ts";
import { leaveActiveCell, mountTable } from "./table.ts";
import { clickTask, photoResize } from "./widgets.ts";
import { theme } from "./theme.ts";
import { composingStyle, typingCaret } from "./typingcaret.ts";
import { invisibles } from "./invisibles.ts";

/** The nonce of the page's content security policy, for CodeMirror's style elements. */
export function cspNonce(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content ?? "";
}

export interface NoteViewOptions {
  parent: HTMLElement;
  text: string;
  mode: Mode;
  /** Spaces, tabs and line ends are drawn. */
  invisibles: boolean;
  photoUrl: (destination: string) => string | null;
  renderTable: (markdown: string) => HTMLElement;
  /** Keys of the toolbar (Ctrl+B and the others), in both modes. */
  keys: KeyBinding[];
  onSave(): void;
  onChange(): void;
  onUpdate(): void;
  onFiles(view: EditorView, files: File[]): void;
  onLink(view: EditorView, from: number, to: number, url: string): void;
  keepsTyping(target: Element | null): boolean;
}

export interface NoteView {
  view: EditorView;
  setMode(m: Mode): void;
  setInvisibles(on: boolean): void;
  setText(text: string): void;
  destroy(): void;
}

export function createNoteView(o: NoteViewOptions): NoteView {
  const modeSlot = new Compartment();
  const invisibleSlot = new Compartment();
  const ropts: RichOptions = {
    photoUrl: o.photoUrl,
    renderTable: o.renderTable,
    mountTable,
    onTask: clickTask,
    onPhoto: photoResize,
    onSave: () => o.onSave(),
    onTableAsText: (view, wrap) => {
      // A cell being edited is written first (7.7). Writing it changes only the table, so where
      // the table starts stays where it was.
      const at = view.posAtDOM(wrap);
      leaveActiveCell();
      view.dispatch({ effects: tableAsText.of(at), selection: { anchor: Math.min(at + 2, view.state.doc.length) } });
      view.focus();
    },
  };
  const rich = (): Extension => [
    modeFacet.of("rich"),
    richInput({ onFiles: o.onFiles, keepsTyping: o.keepsTyping }),
    EditorView.decorations.from(editorField, (v) => v.decorations),
    typingCaret,
    composingStyle,
    EditorView.atomicRanges.of((view) => view.state.field(editorField).atomic),
    EditorView.editorAttributes.of({ class: "cm-rich", "data-mode": "rich" }),
    EditorView.domEventHandlers({
      click(e, view) {
        const a = (e.target as HTMLElement | null)?.closest?.(".rich-run[data-link]") as HTMLElement | null;
        if (!a || e.button !== 0 || e.shiftKey) return false;
        // Clicking a link selects it and opens the panel to edit, open or remove it.
        setTimeout(() => {
          const pos = view.posAtDOM(a);
          const doc = view.state.doc.toString();
          const l = linkAt(doc, pos) ?? linkAt(doc, pos + 1);
          if (!l) return;
          view.dispatch({ selection: EditorSelection.single(l.from, l.to) });
          o.onLink(view, l.from, l.to, l.url);
        }, 0);
        return false;
      },
    }),
  ];
  const raw = (): Extension => [modeFacet.of("raw"), keymap.of(defaultKeymap), rawInput({ onFiles: o.onFiles }), EditorView.editorAttributes.of({ "data-mode": "raw" })];
  const state = EditorState.create({
    doc: o.text,
    extensions: [
      EditorView.cspNonce.of(cspNonce()),
      richOptions.of(ropts),
      editorField,
      modeSlot.of(o.mode === "rich" ? rich() : raw()),
      invisibleSlot.of(o.invisibles ? invisibles() : []),
      // Composition gets a history boundary before it starts (8).
      history({ joinToEvent: (tr, adjacent) => adjacent && !tr.isUserEvent("input.type.compose.start") }),
      drawSelection(),
      EditorView.lineWrapping,
      theme,
      placeholder("Write your note…"),
      Prec.high(keymap.of([{ key: "Mod-s", preventDefault: true, run: () => (o.onSave(), true) }, ...o.keys])),
      // Undo and redo keep the caret at stops in Rich mode (8).
      // (The history's commands are state commands; a view is a valid target for them.)
      keymap.of(historyKeymap.map((b) => (b.run ? { ...b, run: atStops(b.run as unknown as StateCommand) } : b))),
      EditorView.editorAttributes.of({ "data-testid": "editor" }),
      EditorView.contentAttributes.of({ "aria-label": "Note text", spellcheck: "true", autocapitalize: "sentences" }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) o.onChange();
        if (u.docChanged || u.selectionSet || u.transactions.some((t) => t.effects.length)) o.onUpdate();
      }),
    ],
  });
  const view = new EditorView({ state, parent: o.parent });
  // Rich: a click under a table that ends the note makes an empty line there and puts the caret
  // on it; otherwise there is no place below the table to type. It is an intent, `lineAfterTable`,
  // reduced and checked like any other (review of alpha's changes, 23). A cell being edited is
  // written first, and the intent reads the note as it is after that (1).
  view.scrollDOM.addEventListener(
    "mousedown",
    (e) => {
      const f = view.state.field(editorField);
      if (e.button !== 0 || !f.rich || !finalTable(f.model)) return;
      const lines = view.contentDOM.children;
      const bottom = lines.length ? lines[lines.length - 1].getBoundingClientRect().bottom : 0;
      if (e.clientY <= bottom || (e.target as HTMLElement | null)?.closest?.(".rich-table")) return;
      e.preventDefault();
      e.stopPropagation();
      leaveActiveCell();
      if (view.state.field(editorField).rich && finalTable(view.state.field(editorField).model)) dispatchIntent(view, { type: "lineAfterTable" });
      view.focus();
    },
    true,
  );
  if (o.mode === "rich") view.dispatch({ effects: setRich.of(true), selection: view.state.selection });
  // The caret starts after the front matter.
  view.dispatch({ selection: EditorSelection.single(view.state.selection.main.head) });
  return {
    view,
    setMode(m: Mode) {
      view.dispatch({ effects: [modeSlot.reconfigure(m === "rich" ? rich() : raw()), setRich.of(m === "rich")] });
      // The switch to Rich puts a selection end that is not at a caret stop at the nearest one.
      view.dispatch({ selection: view.state.selection });
    },
    setInvisibles(on: boolean) {
      view.dispatch({ effects: invisibleSlot.reconfigure(on ? invisibles() : []) });
    },
    setText(text: string) {
      loadText(view, text);
    },
    destroy() {
      view.destroy();
    },
  };
}
