// A saved style in a table cell (SPEC-CELLS): the `applyStyleCell` operation, through `reduce`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { reduce, type Doc, type SavedStyle, type TableOp } from "../src/index.ts";

const style = (s: Partial<SavedStyle>): SavedStyle => ({ name: "s", bold: false, italic: false, underline: false, strike: false, size: null, font: null, color: null, bg: null, ...s });
const LOUD = style({ bold: true, underline: true, size: 18, font: "mono", color: "red", bg: "#fff176" });
const QUIET = style({ italic: true, color: "blue" });
const LOUD_MD = "[**apples**]{font=mono size=18pt underline=yes color=red bg=#fff176}";

const table = (a: string, b = "pears", head = "| A | B |") => `Before\n\n${head}\n| --- | --- |\n| ${a} | ${b} |\n\nAfter`;
const ap = (s: SavedStyle | "reset", from = 0, to = 0, row = 1, col = 0): TableOp => ({ op: "applyStyleCell", row, col, from, to, style: s });

/** The operations one after another; the note's text, and what was skipped or why it stopped. */
function edit(text: string, ops: TableOp[], pending?: { row: number; col: number; markdown: string }): { text: string; skipped: string[]; refused: string | null } {
  let doc: Doc = { text, sel: { anchor: 0, head: 0 }, typing: { marks: [] } };
  const skipped: string[] = [];
  for (const op of ops) {
    const r = reduce(doc, { type: "tableEdit", at: text.indexOf("|"), op, ...(pending ? { pending } : {}) }, "rich");
    if (!r.ok) return { text: doc.text, skipped, refused: r.reason };
    doc = r.doc;
    if (r.skipped) skipped.push(...r.skipped.reasons);
  }
  return { text: doc.text, skipped, refused: null };
}
const cells = (text: string) => text.split("\n").filter((l) => l.startsWith("|")).pop()!;

test("a saved style on a cell: each setting takes the style's value", () => {
  assert.equal(cells(edit(table("apples"), [ap(LOUD)]).text), `| ${LOUD_MD} | pears |`);
  // It sets and does not toggle: on a cell already bold, italic and struck, and picked twice.
  assert.equal(cells(edit(table("~~***apples***~~"), [ap(LOUD)]).text), `| ${LOUD_MD} | pears |`);
  assert.equal(cells(edit(table("apples"), [ap(LOUD), ap(LOUD)]).text), `| ${LOUD_MD} | pears |`);
  assert.equal(cells(edit(table("apples"), [ap(QUIET), ap(QUIET)]).text), "| [*apples*]{color=blue} | pears |");
  // One style over another: every setting is the last style's.
  assert.equal(cells(edit(table(LOUD_MD), [ap(QUIET)]).text), "| [*apples*]{color=blue} | pears |");
});

test("a saved style on a cell: with text selected, that text; with only the caret, the whole cell", () => {
  assert.equal(cells(edit(table("apples pears"), [ap(QUIET, 0, 6)]).text), "| [*apples*]{color=blue} pears | pears |");
  assert.equal(cells(edit(table("apples pears"), [ap(QUIET, 7, 12)]).text), "| apples [*pears*]{color=blue} | pears |");
  assert.equal(cells(edit(table("apples pears"), [ap(QUIET, 3, 3)]).text), "| [*apples pears*]{color=blue} | pears |");
});

test("a saved style on a cell: a style that names no size writes none, and takes away the text's own", () => {
  assert.equal(cells(edit(table("[apples]{size=18pt}"), [ap(QUIET)]).text), "| [*apples*]{color=blue} | pears |");
  // In a note whose size is not the usual one too.
  const note = `---\nsize: 14pt\n---\n\n${table("apples")}`;
  assert.doesNotMatch(cells(edit(note, [ap(QUIET)]).text), /size=/);
});

test("a saved style on a cell: Default (reset) clears the formatting and keeps a link", () => {
  assert.equal(cells(edit(table(LOUD_MD), [ap("reset")]).text), "| apples | pears |");
  assert.equal(cells(edit(table("[apples](https://x.org) **b**"), [ap("reset")]).text), "| [apples](https://x.org) b | pears |");
  assert.equal(cells(edit(table("**apples** pears"), [ap("reset", 0, 6)]).text), "| apples pears | pears |");
});

test("a saved style on a cell: different styles in different cells, and nothing else changes", () => {
  const before = table("a \\| b \\* c", "[link](https://x.org)", "| **A** | B |");
  const r = edit(before, [ap(QUIET, 0, 0, 1, 1), ap(LOUD, 0, 0, 0, 1)]);
  assert.equal(r.refused, null);
  const lines = r.text.split("\n");
  assert.equal(lines[0], "Before");
  assert.equal(lines[lines.length - 1], "After");
  assert.equal(lines[2], "| **A** | [**B**]{font=mono size=18pt underline=yes color=red bg=#fff176} |", "the header row's other cell is as it was");
  assert.equal(cells(r.text), "| a \\| b \\* c | [*[link](https://x.org)*]{color=blue} |", "the cell beside it keeps its escapes");
});

test("a saved style on a cell: an empty cell is refused; text typed and not yet written goes in with it", () => {
  const empty = edit(table(""), [ap(LOUD)]);
  assert.match(empty.refused ?? "", /type something in the cell first/i);
  assert.equal(empty.text, table(""));
  // The cell still held "app" on disk; "apples" was typed and is pending.
  const typed = edit(table("app"), [ap(QUIET)], { row: 1, col: 0, markdown: "apples" });
  assert.equal(typed.refused, null);
  assert.equal(cells(typed.text), "| [*apples*]{color=blue} | pears |");
  assert.match(edit(table("apples"), [ap(LOUD, 0, 0, 5, 0)]).refused ?? "", /no such cell/);
});
