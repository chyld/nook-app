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
  const r = steps("¦", [{ type: "applyStyle", style: RED }, { type: "setBlock", kind: "code" }, type("h")]);
  assert.equal(r.out, "h¦\n{color=red}");
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0]!, /^Code block was not applied with this style: /);
});

const ALL = style({ bold: true, italic: true, underline: true, strike: true, size: 20, font: "serif", color: "red", bg: "yellow" });
const one = (marked: string, intents: Intent[]) => {
  const r = steps(marked, intents);
  assert.deepEqual(r.skipped, [], marked);
  return r.out;
};
const Q: Intent = { type: "setBlock", kind: "quote" };
const list = (kind: "bullet" | "ordered" | "task" | "none"): Intent => ({ type: "setList", kind });

test("a paragraph whose style is an attribute line becomes a quote: the style goes into spans", () => {
  assert.equal(one("hel¦lo\n{color=red}", [Q]), "> [hel¦lo]{color=red}");
  assert.equal(one("**hel¦lo**\n{size=20pt color=red}", [Q]), "> [**hel¦lo**]{color=red size=20pt}");
  assert.equal(one("hel¦lo\n{color=red}", [Q, { type: "setBlock", kind: "paragraph" }]), "[hel¦lo]{color=red}", "and back to a paragraph");
  // What the paragraph already had inside it is kept: a span of its own, a colour over the block's, a link.
  assert.equal(one("left [mid¦]{bg=yellow} right\n{color=red}", [Q]), "> [left ]{color=red}[mid¦]{bg=yellow color=red}[ right]{color=red}");
  assert.equal(one("left [mid¦]{color=blue} right\n{color=red}", [Q]), "> [left ]{color=red}[mid¦]{color=blue}[ right]{color=red}");
  assert.equal(one("see [th¦is](https://example.com) now\n{color=red}", [Q]), "> [see [th¦is](https://example.com) now]{color=red}");
  // Several paragraphs, several lines, and text on either side that does not change.
  assert.equal(one("«one\n{color=red}\n\ntwo\n{color=blue}»", [Q]), "> [«one]{color=red}\n\n> [two»]{color=blue}");
  assert.equal(one("one\ntw¦o\n{color=red}", [Q]), "> [one\n> tw¦o]{color=red}");
  assert.equal(one("before\n\nhel¦lo\n{color=red}\n\nafter", [Q]), "before\n\n> [hel¦lo]{color=red}\n\nafter");
  // Every property a saved style has.
  assert.equal(one("«hello»", [{ type: "applyStyle", style: ALL }, Q]), "> [~~***«hello»***~~]{color=red bg=yellow font=serif size=20pt underline=yes}");
});

test("a paragraph whose style is an attribute line becomes a list item, of each kind", () => {
  assert.equal(one("hel¦lo\n{color=red}", [list("bullet")]), "- [hel¦lo]{color=red}");
  assert.equal(one("hel¦lo\n{color=red}", [list("ordered")]), "1. [hel¦lo]{color=red}");
  assert.equal(one("hel¦lo\n{color=red}", [list("task")]), "- [ ] [hel¦lo]{color=red}");
  assert.equal(one("hel¦lo\n{color=red}", [list("bullet"), list("none")]), "[hel¦lo]{color=red}", "and off again");
  assert.equal(one("«one\n{color=red}\n\ntwo\n{color=blue}»", [list("bullet")]), "- [«one]{color=red}\n- [two»]{color=blue}");
  assert.equal(one("hello¦\n{color=red}", [list("bullet"), type("!")]), "- [hello!¦]{color=red}");
  // A selection that ends with a code block ends at the code's last character, not in its closing fence.
  assert.equal(one("«one\n{color=red}\n\n```\ncode\n```»", [list("bullet")]), "- [«one]{color=red}\n\n```\ncode»\n```");
});

test("an empty line: a saved style with a quote or a list, in either order, then typing", () => {
  assert.equal(one("¦", [{ type: "applyStyle", style: RED }, Q, type("h"), type("i")]), "> [hi¦]{color=red}");
  assert.equal(one("¦", [Q, { type: "applyStyle", style: BIG }, type("h"), type("i")]), "> [**hi¦**]{color=red size=20pt}");
  assert.equal(one("¦\n\nafter", [{ type: "applyStyle", style: BIG }, Q, type("h"), type("i")]), "> [**hi¦**]{color=red size=20pt}\n\nafter");
  for (const [kind, mark] of [["bullet", "- "], ["ordered", "1. "], ["task", "- [ ] "]] as const) {
    assert.equal(one("¦", [{ type: "applyStyle", style: BIG }, list(kind), type("h"), type("i")]), `${mark}[**hi¦**]{size=20pt color=red}`, `style, then ${kind}`);
    assert.equal(one("¦", [list(kind), { type: "applyStyle", style: BIG }, type("h"), type("i")]), `${mark}[**hi¦**]{size=20pt color=red}`, `${kind}, then style`);
    assert.equal(one("¦", [{ type: "applyStyle", style: RED }, list(kind), type("h"), type("i")]), `${mark}[hi¦]{color=red}`, `a style with no size, then ${kind}`);
  }
});

test("after a block change the caret stays in its block, with other text below", () => {
  assert.equal(one("hello¦\n\nafter", [{ type: "setBlock", kind: "h3" }]), "### hello¦\n\nafter");
  assert.equal(one("**hello**¦\n\nafter", [{ type: "setBlock", kind: "h3" }]), "### **hello¦**\n\nafter");
  assert.equal(one("¦\n\nafter", [{ type: "setBlock", kind: "h3" }, type("h"), type("i")]), "### hi¦\n\nafter");
  assert.equal(one("¦\n\nafter", [{ type: "applyStyle", style: RED }, { type: "setBlock", kind: "h3" }, type("h"), type("i")]), "### hi¦\n{color=red}\n\nafter");
  assert.equal(one("hello¦\n\nafter", [Q]), "> hello¦\n\nafter");
  // Out of a code block, and on to another block by way of a paragraph.
  assert.equal(one("```\nhello¦\n```\n\nafter", [{ type: "setBlock", kind: "paragraph" }]), "hello¦\n\nafter");
  assert.equal(one("```\nhello¦\n```\n\nafter", [{ type: "setBlock", kind: "h2" }]), "## hello¦\n\nafter");
  assert.equal(one("```\n¦hello\n```\n\nafter", [{ type: "setBlock", kind: "quote" }]), "> ¦hello\n\nafter");
  assert.equal(one("before\n\nhello¦\n\nafter", [{ type: "setBlock", kind: "code" }]), "before\n\n```\nhello¦\n```\n\nafter");
  assert.equal(one("before\n\n¦hello\n\nafter", [{ type: "setBlock", kind: "h3" }]), "before\n\n### ¦hello\n\nafter");
  // A styled paragraph made a quote or a list: at its start, in it and at its end, between other text.
  for (const [intent, mark] of [[Q, "> "], [list("bullet"), "- "], [list("ordered"), "1. "], [list("task"), "- [ ] "]] as const) {
    assert.equal(one("before\n\n¦hello\n{color=red}\n\nafter", [intent]), `before\n\n${mark}[¦hello]{color=red}\n\nafter`, `start, ${mark}`);
    assert.equal(one("before\n\nhel¦lo\n{color=red}\n\nafter", [intent]), `before\n\n${mark}[hel¦lo]{color=red}\n\nafter`, `middle, ${mark}`);
    assert.equal(one("before\n\nhello¦\n{color=red}\n\nafter", [intent]), `before\n\n${mark}[hello¦]{color=red}\n\nafter`, `end, ${mark}`);
  }
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

test("an image's width line is not taken for a style: the change is refused, as before", () => {
  for (const intent of [Q, list("bullet"), { type: "setBlock", kind: "h3" }] as Intent[]) {
    const r = run("![a](x.png)¦\n{width=50%}", intent);
    assert.ok("refused" in r, `${JSON.stringify(intent)}: ${"out" in r ? r.out : ""}`);
  }
});
