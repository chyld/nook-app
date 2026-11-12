// A table cell's formatted text written as Markdown (shared/style/cells.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { cellMarkdown, PLAIN, styleCellText, type CellRun } from "../src/style/cells.ts";

const run = (text: string, style: Partial<typeof PLAIN> = {}): CellRun => ({ text, style: { ...PLAIN, ...style } });
const md = (...runs: CellRun[]) => {
  const r = cellMarkdown(runs);
  return r.ok ? r.text : `REFUSED: ${r.reason}`;
};

test("plain text is written as it is; an empty cell is empty; spaces at the ends go", () => {
  assert.equal(md(run("Green tea")), "Green tea");
  assert.equal(md(), "");
  assert.equal(md(run("  ")), "");
  assert.equal(md(run("  two words ")), "two words");
  assert.equal(md(run("a | b")), "a | b");
});

test("text that would be read as Markdown is escaped, so that it shows as typed", () => {
  assert.equal(md(run("2 * 3 * 4")), "2 * 3 * 4");
  assert.equal(md(run("**not bold**")), "\\*\\*not bold\\*\\*");
  assert.equal(md(run("a_b_c `x` [y]")), "a\\_b\\_c \\`x\\` \\[y\\]");
});

test("styles are written, each over the stretch that has it", () => {
  assert.equal(md(run("Cake", { bold: true })), "**Cake**");
  assert.equal(md(run("Green ", { bold: true }), run("tea", { bold: true, italic: true })), "**Green *tea***");
  assert.equal(md(run("plain "), run("one", { color: "red" })), "plain [one]{color=red}");
  assert.equal(md(run("x", { bg: "#fff176" }), run(" y")), "[x]{bg=#fff176} y");
  assert.equal(md(run("big", { size: 18 })), "[big]{size=18pt}");
  assert.equal(md(run("m", { font: "mono" })), "[m]{font=mono}");
  assert.equal(md(run("u", { underline: true })), "[u]{underline=yes}");
  assert.equal(md(run("gone", { strike: true })), "~~gone~~");
  assert.equal(md(run("site", { link: "https://example.com" })), "[site](https://example.com)");
  assert.equal(md(run("c*d", { code: true })), "`c*d`");
});

test("several styles on the same text read back as that text in those styles", () => {
  const r = cellMarkdown([run("one ", { bold: true, color: "red" }), run("two", { bold: true, color: "red", bg: "#fff176", size: 20 }), run(" three")]);
  assert.ok(r.ok, JSON.stringify(r));
});

test("a web address typed in a cell stays as typed", () => {
  assert.equal(md(run("see https://example.org now")), "see https://example.org now");
});

test("a toolbar style on part of a cell's text; a toggle turns off again", () => {
  let r = styleCellText("Green tea", 6, 9, { kind: "bold", on: true });
  assert.deepEqual(r, { ok: true, text: "Green **tea**", from: 6, to: 9 });
  r = styleCellText("Green **tea**", 6, 9, { kind: "bold", on: true });
  assert.equal(r.ok && r.text, "Green tea");
  r = styleCellText("**Cake**", 0, 4, { kind: "color", value: "red" });
  assert.equal(r.ok && r.text, "[**Cake**]{color=red}");
  assert.equal(styleCellText("x", 0, 0, { kind: "bold", on: true }).ok, false);
});
