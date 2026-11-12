// SPEC2 7.7, in Node: the focused table cell's text is written when the cell is left, whatever
// way it is left, and a save sees it. `CellFocus` is the part of the table widget that decides
// what is written; here its `write` applies the `tableEdit` intent to a real EditorState, and
// each way of leaving is the call the widget makes for it (the e2e journeys do the same in
// Chromium: e2e/cells.test.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorSelection, EditorState } from "@codemirror/state";
import { history } from "@codemirror/commands";
import { PLAIN, type PendingCell, type TableOp } from "../../core/src/index.ts";
import { editorField, richOptions, setRich } from "../src/editor/field.ts";
import { intentSpecs, modeFacet, richInput } from "../src/editor/dispatch.ts";
import { CellFocus } from "../src/editor/table.ts";

interface Cell {
  row: number;
  col: number;
  /** What the cell shows now (its DOM), and what it showed when it was entered. */
  shown: string;
  initial: string;
}

const TEXT = "top\n\n| Column 1 | Column 2 |\n|---|---|\n| | |";

function setup() {
  let state = EditorState.create({
    doc: TEXT,
    selection: EditorSelection.single(3),
    extensions: [richOptions.of({ photoUrl: () => null }), editorField, modeFacet.of("rich"), ...richInput({ onFiles: () => {}, keepsTyping: () => false }), history()],
  });
  state = state.update({ effects: setRich.of(true) }).state;
  const at = TEXT.indexOf("|");
  const send = (op: TableOp, pending?: PendingCell): boolean => {
    const r = intentSpecs(state, { type: "tableEdit", at, op, ...(pending ? { pending } : {}) });
    if (!r.ok) return false;
    for (const spec of r.specs) state = state.update(spec).state;
    return true;
  };
  const read = (c: Cell): PendingCell | undefined => (c.shown === c.initial ? undefined : { row: c.row, col: c.col, runs: [{ text: c.shown, style: PLAIN }] });
  const targets: unknown[] = [];
  const focus = new CellFocus<Cell, { row: number; col: number }>(read, (p, to) => {
    targets.push(to);
    return send({ op: "setCell", row: p.row, col: p.col, runs: "runs" in p ? p.runs : [] });
  });
  const cell = (row: number, col: number): Cell => ({ row, col, shown: "", initial: "" });
  /** Click cell row 1 col 0, type "hello". */
  const typed = () => {
    const c = cell(1, 0);
    assert.equal(focus.enter(c), true);
    c.shown = "hello";
    return c;
  };
  /** The note's save: the text it sends. */
  const save = () => state.doc.toString();
  return { focus, typed, cell, send, save, targets, text: () => state.doc.toString() };
}

const written = /\| hello \| +\|$/;

// Each way of leaving is the call the widget makes for it (table.ts): a blur is `leave(c)`; a
// click on another cell is `leave(c, target)`, and the write is told where the focus goes; Save
// and Ctrl+S are `flush(c)` (through the editor store's `flush`, web/test/lost-text.test.ts),
// which leaves an unchanged cell the focused one (review, 43; finding 3).

test("leaving by a click in the note's text or the search box (blur) writes the cell and leaves it", () => {
  const t = setup();
  const c = t.typed();
  assert.match(t.text(), /\| \| \|$/, "not written while the cell has the focus");
  assert.equal(t.focus.leave(c), "written");
  assert.equal(t.focus.editing, null);
  assert.match(t.save(), written);
  assert.deepEqual(t.targets, [null], "no cell is focused next");
});

test("leaving by a click on another cell writes the cell, and the write is told which cell is next", () => {
  const t = setup();
  const c = t.typed();
  assert.equal(t.focus.leave(c, { row: 0, col: 1 }), "written");
  assert.deepEqual(t.targets, [{ row: 0, col: 1 }]);
  assert.equal(t.focus.enter(t.cell(0, 1)), true);
  assert.match(t.save(), written);
});

test("Save or Ctrl+S with a changed cell: flush writes it first", () => {
  const t = setup();
  const c = t.typed();
  assert.equal(t.focus.flush(c), "written");
  assert.match(t.save(), written);
  // The blur that may follow writes nothing more.
  assert.equal(t.focus.leave(c), "not-editing");
});

test("Save with an unchanged cell: flush writes nothing and the cell stays the focused one", () => {
  const t = setup();
  const c = t.cell(1, 0);
  t.focus.enter(c);
  assert.equal(t.focus.flush(c), "unchanged");
  assert.equal(t.focus.editing, c, "still the focused cell");
  c.shown = "hello";
  assert.equal(t.focus.flush(c), "written", "what is typed next is written by the next Save");
  assert.match(t.save(), written);
});

test("the text is read while the cell is still the focused one (the bug: it was read after)", () => {
  const seen: (Cell | null)[] = [];
  let focus!: CellFocus<Cell>;
  focus = new CellFocus<Cell>(
    (c) => {
      seen.push(focus.editing);
      return { row: c.row, col: c.col, runs: [{ text: c.shown, style: PLAIN }] };
    },
    () => true,
  );
  const c: Cell = { row: 1, col: 0, shown: "hello", initial: "" };
  focus.enter(c);
  focus.leave(c);
  assert.deepEqual(seen, [c]);
});

test("an unchanged cell writes nothing; Escape discards", () => {
  const t = setup();
  const c = t.cell(1, 0);
  t.focus.enter(c);
  assert.equal(t.focus.leave(c), "unchanged");
  const d = t.typed();
  t.focus.discard(d);
  assert.equal(t.focus.leave(d), "not-editing");
  assert.match(t.text(), /\| \| \|$/);
});

test("a style and the row and column buttons carry the unsaved text as pending", () => {
  for (const op of [
    { op: "styleCell", row: 1, col: 0, from: 0, to: 0, change: { kind: "bold", on: true } },
    { op: "addRow", after: 1 },
    { op: "addColumn", after: 0 },
  ] as TableOp[]) {
    const t = setup();
    t.typed();
    const p = t.focus.pending();
    assert.ok(p, "the focused cell's text is pending");
    assert.equal(t.send(op, p ?? undefined), true);
    assert.match(t.save(), op.op === "styleCell" ? /\| \*\*hello\*\* \|/ : /\| hello \|/, op.op);
  }
});
