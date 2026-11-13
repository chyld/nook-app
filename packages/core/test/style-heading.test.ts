// A saved style together with a heading (SPEC-NOTES, "A saved style with a heading"): scenarios
// through `reduce`, as in scenarios.test.ts. Found by trying the app: the heading was lost, or
// refused, whenever the style was written as an attribute line under the paragraph.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel, describe, reduce, shownSize, type Doc, type Intent, type SavedStyle } from "../src/index.ts";
import { parse, run, show } from "./scenario.ts";

const style = (s: Partial<SavedStyle>): SavedStyle => ({ name: "s", bold: false, italic: false, underline: false, strike: false, size: null, font: null, color: null, bg: null, ...s });
const BIG = style({ bold: true, size: 20, color: "red" });
const RED = style({ color: "red" });

/** The intents one after another from a marked text, in Rich; the text with its caret at the end. */
function steps(marked: string, intents: Intent[]): { out: string; doc: Doc; skipped: string[] } {
  let doc = parse(marked);
  const skipped: string[] = [];
  for (const i of intents) {
    const r = reduce(doc, i, "rich");
    assert.ok(r.ok, `${JSON.stringify(i)} refused: ${r.ok ? "" : r.reason}`);
    doc = r.doc;
    if (r.skipped) skipped.push(...r.skipped.reasons);
  }
  return { out: show(doc), doc, skipped };
}
const type = (text: string): Intent => ({ type: "insertText", text });

test("an empty line: a saved style and a heading, in either order, give a styled heading", () => {
  for (const kind of ["h1", "h2", "h3", "h4", "h5", "h6"] as const) {
    const marks = "#".repeat(Number(kind[1]));
    for (const order of [[{ type: "applyStyle", style: BIG }, { type: "setBlock", kind }], [{ type: "setBlock", kind }, { type: "applyStyle", style: BIG }]] as Intent[][]) {
      const r = steps("¦", [...order, type("h"), type("i")]);
      assert.equal(r.out, `${marks} **hi¦**\n{size=20pt color=red}`, `${kind}, ${JSON.stringify(order.map((o) => o.type))}`);
      assert.deepEqual(r.skipped, []);
    }
  }
  assert.equal(steps("intro\n\n¦", [{ type: "applyStyle", style: RED }, { type: "setBlock", kind: "h3" }, type("h")]).out, "intro\n\n### h¦\n{color=red}", "under other text");
});

test("a paragraph whose style is an attribute line becomes a heading, and changes level", () => {
  const r = run("hel¦lo\n{color=red}", { type: "setBlock", kind: "h3" });
  assert.ok("out" in r, "refused" in r ? r.refused : "");
  assert.equal(r.out, "### hel¦lo\n{color=red}");
  const again = run(r.doc, { type: "setBlock", kind: "h2" });
  assert.ok("out" in again, "refused" in again ? again.refused : "");
  assert.equal(again.out, "## hel¦lo\n{color=red}");
  const back = run(again.doc, { type: "setBlock", kind: "paragraph" });
  assert.ok("out" in back);
  assert.equal(back.out, "hel¦lo\n{color=red}");
  // Every kind of line end before the attribute line.
  for (const nl of ["\r\n", "\r"]) {
    const cr = run(`hel¦lo${nl}{color=red}`, { type: "setBlock", kind: "h3" });
    assert.ok("out" in cr, JSON.stringify(nl));
    assert.equal(cr.out, `### hel¦lo${nl}{color=red}`);
  }
  // Text of several lines is still not a heading, with or without the attribute line.
  for (const t of ["one\ntw¦o", "one\ntw¦o\n{color=red}"]) {
    const no = run(t, { type: "setBlock", kind: "h3" });
    assert.ok("refused" in no, t);
    assert.match(no.refused, /one line/);
  }
});

test("a saved style with no size leaves a heading its size", () => {
  const sel = parse("### «hello»");
  const r = reduce(sel, { type: "applyStyle", style: RED }, "rich");
  assert.ok(r.ok);
  assert.equal(r.doc.text, "### hello\n{color=red}");
  // At a caret in a heading, what is typed next has the heading's size too.
  assert.equal(steps("### h¦", [{ type: "applyStyle", style: RED }, type("i")]).out, "### h[i¦]{color=red}");
  // Enter out of the heading: the paragraph it makes has the note's size, not the heading's.
  assert.equal(steps("### hello¦", [{ type: "applyStyle", style: RED }, { type: "enter" }, type("x")]).out, "### hello\n\nx¦\n{color=red}");
  assert.equal(steps("### hello¦", [{ type: "applyStyle", style: BIG }, { type: "enter" }, type("x")]).out, "### hello\n\n**x¦**\n{size=20pt color=red}");
  // Enter in the middle of a heading: the second half is a heading still, at its own size.
  const mid = steps("### hel¦lo", [{ type: "applyStyle", style: RED }, { type: "enter" }, type("x")]);
  assert.doesNotMatch(mid.out, /size=/, mid.out);
  // A style that names a size still sets it.
  const big = reduce(sel, { type: "applyStyle", style: BIG }, "rich");
  assert.ok(big.ok);
  assert.equal(big.doc.text, "### **hello**\n{size=20pt color=red}");
});

test("a block the first letter cannot start is said, not dropped in silence", () => {
  const r = steps("¦", [{ type: "applyStyle", style: RED }, { type: "setBlock", kind: "quote" }, type("h")]);
  assert.equal(r.out, "h¦\n{color=red}");
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0]!, /^Quote was not applied with this style: /);
});

test("a style waiting at the caret is kept when the line becomes a heading", () => {
  const r = steps("hello¦", [{ type: "applyStyle", style: BIG }, { type: "setBlock", kind: "h3" }, type("!")]);
  assert.equal(r.out, "### hello[**!¦**]{size=20pt color=red}");
  // A waiting style that names no size takes the new block's size, not the old one's.
  assert.equal(steps("## Alpha¦", [{ type: "applyStyle", style: RED }, { type: "setBlock", kind: "h3" }, type("B")]).out, "### Alpha[B¦]{color=red}");
  assert.equal(steps("## Alpha¦", [{ type: "applyStyle", style: RED }, { type: "setBlock", kind: "paragraph" }, type("B")]).out, "Alpha[B¦]{color=red}");
  // A size the style names is kept, even when it equals the old block's own (Heading 2 is 18pt).
  const H2SIZE = style({ size: 18, color: "red" });
  assert.equal(steps("## Alpha¦", [{ type: "applyStyle", style: H2SIZE }, { type: "setBlock", kind: "h3" }, type("B")]).out, "### Alpha[B¦]{size=18pt color=red}");
  assert.equal(steps("## Alpha¦", [{ type: "applyStyle", style: H2SIZE }, { type: "enter" }, type("B")]).out, "## Alpha\n\nB¦\n{size=18pt color=red}");
  // Code takes no style: nothing waits after the line becomes a code block.
  const code = steps("hello¦", [{ type: "applyStyle", style: BIG }, { type: "setBlock", kind: "code" }]);
  assert.deepEqual(code.doc.typing, { marks: [], block: null });
  // With no style waiting, nothing is left waiting.
  const plain = reduce(parse("hello¦"), { type: "setBlock", kind: "h3" }, "rich");
  assert.ok(plain.ok);
  assert.deepEqual(plain.doc.typing, { marks: [], block: null });
});

test("the size shown for a waiting style with no size is the waiting heading's", () => {
  for (const order of [[{ type: "applyStyle", style: RED }, { type: "setBlock", kind: "h3" }], [{ type: "setBlock", kind: "h3" }, { type: "applyStyle", style: RED }]] as Intent[][]) {
    const d = steps("¦", order).doc;
    assert.equal(shownSize(buildModel(d.text), d.sel.head, d.typing), 14);
    assert.deepEqual(describe(d, buildModel(d.text)).size, { mixed: false, value: 14 }, "the toolbar's size box");
  }
  const big = steps("¦", [{ type: "applyStyle", style: BIG }, { type: "setBlock", kind: "h3" }]).doc;
  assert.equal(shownSize(buildModel(big.text), big.sel.head, big.typing), 20);
});
