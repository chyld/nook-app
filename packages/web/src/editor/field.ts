// SPEC2 8: one state field holds the model of the current text, `typing`, and the ranges of
// tables shown as text. It is rebuilt in the same transaction as each change: from the `model`
// an intent returned, or by parsing when the change came another way (undo, redo, a load, Raw
// typing). In Rich mode the decorations come only from it; nothing is drawn from an older parse.

import { Annotation, Facet, StateEffect, StateField, type EditorState, type Transaction } from "@codemirror/state";
import { type DecorationSet, Decoration } from "@codemirror/view";
import { RangeSet } from "@codemirror/state";
import { buildModel, type Model, type Typing } from "../../../core/src/index.ts";
import { richDecorations, tableRanges, type RichOptions } from "./decorations.ts";

/** Marks a transaction made by `dispatchIntent`. */
export const intentMark = Annotation.define<boolean>();
/** Marks a load: "Take theirs", opening a draft. */
export const loadMark = Annotation.define<boolean>();

export const setModel = StateEffect.define<Model>();
export const setTyping = StateEffect.define<Typing>();
/** Rich (true) or Raw (false): decorations are made only in Rich mode. */
export const setRich = StateEffect.define<boolean>();
/** "Edit as text": a table shown as its raw rows, by its start position. */
export const tableAsText = StateEffect.define<number>({ map: (v, ch) => ch.mapPos(v) });

/** The options of the Rich view (photo addresses, widget actions). */
export const richOptions = Facet.define<RichOptions, RichOptions>({ combine: (v) => v[0] ?? { photoUrl: () => null } });

export const NO_TYPING: Typing = { marks: [] };

export interface EditorValue {
  model: Model;
  typing: Typing;
  rich: boolean;
  /** Tables shown as text: their start positions. */
  rawTables: number[];
  /** Every table's lines [from, to]. */
  tables: [number, number][];
  decorations: DecorationSet;
  atomic: RangeSet<Decoration>;
  /** Milliseconds the last parse and decoration took. */
  ms: number;
}

function build(model: Model, typing: Typing, rich: boolean, raw: number[], opts: RichOptions): EditorValue {
  const t = performance.now();
  if (!rich) {
    return { model, typing, rich, rawTables: [], tables: tableRanges(model), decorations: Decoration.none, atomic: RangeSet.empty, ms: performance.now() - t };
  }
  const d = richDecorations(model, opts, raw);
  return { model, typing, rich, rawTables: d.rawTables, tables: d.tables, decorations: d.decorations, atomic: d.atomic, ms: performance.now() - t };
}

/** A key move or a selection clears `typing`; a plain click that leaves the selection empty
 *  does not (7.4.3), unless it goes into another block that has text: the look waiting was not
 *  chosen for that text, and the toolbar would show it as that text's. Undo and redo clear it. */
function keepsTyping(tr: Transaction, model: Model): boolean {
  if (tr.docChanged) return false;
  if (!tr.selection) return true;
  if (!(tr.isUserEvent("select.pointer") && tr.newSelection.main.empty)) return false;
  const blockAt = (p: number) => model.blocks.findIndex((b) => b.vb > b.va && p >= b.info.range.start && p <= b.info.range.end);
  const to = blockAt(tr.newSelection.main.head);
  return to < 0 || to === blockAt(tr.startState.selection.main.head);
}

export const editorField = StateField.define<EditorValue>({
  create(state) {
    return build(buildModel(state.doc.toString()), NO_TYPING, false, [], state.facet(richOptions));
  },
  update(value, tr) {
    let model = value.model;
    let typing = value.typing;
    let rich = value.rich;
    let raw = value.rawTables.map((p) => tr.changes.mapPos(p));
    let given: Model | null = null;
    let typingSet = false;
    for (const e of tr.effects) {
      if (e.is(setModel)) given = e.value;
      else if (e.is(setTyping)) {
        typing = e.value;
        typingSet = true;
      } else if (e.is(setRich)) rich = e.value;
      else if (e.is(tableAsText)) raw.push(e.value);
    }
    if (tr.docChanged) model = given && given.text.length === tr.newDoc.length ? given : buildModel(tr.newDoc.toString());
    if (!typingSet && !keepsTyping(tr, value.model)) typing = NO_TYPING;
    if (!rich) typing = NO_TYPING;
    // A table shown as text closes when the caret leaves it.
    const head = tr.newSelection.main.head;
    const tables = tr.docChanged ? tableRanges(model) : value.tables;
    raw = raw.filter((p) => tables.some(([a, z]) => p >= a && p <= z && head >= a && head <= z));
    const sameRaw = raw.length === value.rawTables.length && raw.every((p, i) => p === value.rawTables[i]);
    if (!tr.docChanged && sameRaw && rich === value.rich) return typing === value.typing ? value : { ...value, typing };
    return build(model, typing, rich, raw, tr.startState.facet(richOptions));
  },
});

/** The table shown as text that holds `pos`, if any: its lines [from, to]. */
export function rawTableAt(state: EditorState, pos: number): [number, number] | null {
  const v = state.field(editorField, false);
  if (!v) return null;
  for (const [a, z] of v.tables) if (pos >= a && pos <= z && v.rawTables.some((p) => p >= a && p <= z)) return [a, z];
  return null;
}
