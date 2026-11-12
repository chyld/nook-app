// The grid editing of tables in rich mode (shared/style/tables.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { addColumn, addRow, parseTable, removeColumn, removeRow, replaceTable, writeTable } from "../src/style/tables.ts";

const T = "| A | B |\n|---|:-:|\n| 1 | 2 |\n| 3 | 4 |";
const NOTE = `---\nid: abcdefghijkl\n---\nIntro\n\n${T}\n\nOutro\n`;
const at = NOTE.indexOf(T);

test("a plain table reads into cells and writes back", () => {
  const g = parseTable(T)!;
  assert.deepEqual(g.rows, [["A", "B"], ["1", "2"], ["3", "4"]]);
  assert.deepEqual(g.align, ["---", ":-:"]);
  assert.equal(writeTable(g), "| A | B |\n| --- | :-: |\n| 1 | 2 |\n| 3 | 4 |");
});

test("an escaped pipe is one cell's text, and is escaped again when written", () => {
  const g = parseTable("| a \\| b | c |\n|---|---|\n| `x` | |")!;
  assert.deepEqual(g.rows, [["a | b", "c"], ["`x`", ""]]);
  assert.deepEqual(parseTable(writeTable(g))!.rows, g.rows);
});

test("tables that are not plain pipe tables are not taken", () => {
  assert.equal(parseTable("A | B\n---|---\n1 | 2"), null);
  assert.equal(parseTable("> | A |\n> |---|\n> | 1 |"), null);
  assert.equal(parseTable("| A | B |\n| 1 | 2 |"), null);
});

test("a changed cell is written into the note and nothing else changes", () => {
  const g = parseTable(T)!;
  g.rows[1][1] = "two | pipes";
  const r = replaceTable(NOTE, at, at + T.length, g);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.text.slice(0, at), NOTE.slice(0, at));
  assert.equal(r.text.slice(r.to), NOTE.slice(at + T.length));
  assert.deepEqual(parseTable(r.text.slice(r.from, r.to))!.rows, [["A", "B"], ["1", "two | pipes"], ["3", "4"]]);
});

test("a line break typed into a cell becomes a space", () => {
  const g = parseTable(T)!;
  g.rows[2][0] = "one\ntwo";
  const r = replaceTable(NOTE, at, at + T.length, g);
  assert.ok(r.ok && parseTable(r.text.slice(r.from, r.to))!.rows[2][0] === "one two");
});

test("rows and columns are added and removed; the header and the last column stay", () => {
  let g = parseTable(T)!;
  g = addRow(g, 1);
  assert.deepEqual(g.rows, [["A", "B"], ["1", "2"], ["", ""], ["3", "4"]]);
  g = addRow(g, 0);
  assert.deepEqual(g.rows[1], ["", ""]);
  g = addColumn(g, 0);
  assert.deepEqual(g.rows[0], ["A", "", "B"]);
  assert.deepEqual(g.align, ["---", "---", ":-:"]);
  const r = replaceTable(NOTE, at, at + T.length, g);
  assert.ok(r.ok);
  assert.equal(removeRow(g, 0), null);
  g = removeRow(g, 1)!;
  g = removeColumn(g, 1)!;
  assert.deepEqual(g.rows, [["A", "B"], ["1", "2"], ["", ""], ["3", "4"]]);
  assert.equal(removeColumn(removeColumn(g, 0)!, 0), null);
});

test("an empty header is still a table", () => {
  const g = parseTable(T)!;
  g.rows[0] = ["", ""];
  const r = replaceTable(NOTE, at, at + T.length, g);
  assert.ok(r.ok, JSON.stringify(r));
});
