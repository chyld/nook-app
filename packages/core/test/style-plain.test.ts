// Normal text only (SPEC-PLAIN): the editor no longer makes a heading, a quote or a code block.
// Scenarios through `reduce`, as in scenarios.test.ts. First what was found on 2026-11-13 about a
// saved style, or a look waiting at the caret, meeting a list or a heading that is already there
// (SPEC-NOTES, "A saved style with a heading"); then the rules of SPEC-PLAIN 5.1, 5.2 and 5.5.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel, describe, reduce, type Doc, type Intent, type SavedStyle } from "../src/index.ts";
import { setBlockStyle } from "../src/style/blocks.ts";
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
const typed = (text: string): Intent[] => [...text].map((c) => type(c));

/** The intents one after another, each with its `then`, as the editor does (`run`). */
function edit(marked: string, intents: Intent[]): Doc {
  let doc = parse(marked);
  for (const i of intents) {
    const r = run(doc, i);
    assert.ok("out" in r, `${JSON.stringify(i)} on ${JSON.stringify(show(doc))} refused: ${"refused" in r ? r.refused : ""}`);
    doc = r.doc;
  }
  return doc;
}

/** A heading or a quote made normal text (`setBlockStyle`), with the caret shown. */
function normal(marked: string): string {
  const d = parse(marked);
  const r = setBlockStyle(d.text, Math.min(d.sel.anchor, d.sel.head), Math.max(d.sel.anchor, d.sel.head), "paragraph");
  assert.ok(r.ok, `${JSON.stringify(marked)}: ${r.ok ? "" : r.reason}`);
  return show({ text: r.text, sel: { anchor: r.from, head: r.to }, typing: { marks: [] } });
}

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
  // A size the style names is carried by Enter, even when it equals the heading's own (Heading 2 is 18pt).
  const H2SIZE = style({ size: 18, color: "red" });
  assert.equal(steps("## Alpha¦", [{ type: "applyStyle", style: H2SIZE }, { type: "enter" }, type("B")]).out, "## Alpha\n\nB¦\n{size=18pt color=red}");
});

const ALL = style({ bold: true, italic: true, underline: true, strike: true, size: 20, font: "serif", color: "red", bg: "yellow" });
const one = (marked: string, intents: Intent[]) => {
  const r = steps(marked, intents);
  assert.deepEqual(r.skipped, [], marked);
  return r.out;
};
const list = (kind: "bullet" | "ordered" | "task" | "none"): Intent => ({ type: "setList", kind });

test("a paragraph whose style is an attribute line becomes a list item, of each kind", () => {
  assert.equal(one("hel¦lo\n{color=red}", [list("bullet")]), "- [hel¦lo]{color=red}");
  assert.equal(one("hel¦lo\n{color=red}", [list("ordered")]), "1. [hel¦lo]{color=red}");
  assert.equal(one("hel¦lo\n{color=red}", [list("task")]), "- [ ] [hel¦lo]{color=red}");
  assert.equal(one("hel¦lo\n{color=red}", [list("bullet"), list("none")]), "[hel¦lo]{color=red}", "and off again");
  assert.equal(one("«one\n{color=red}\n\ntwo\n{color=blue}»", [list("bullet")]), "- [«one]{color=red}\n- [two»]{color=blue}");
  assert.equal(one("hello¦\n{color=red}", [list("bullet"), type("!")]), "- [hello!¦]{color=red}");
  // A selection that ends with a code block ends at the code's last character, not in its closing fence.
  assert.equal(one("«one\n{color=red}\n\n```\ncode\n```»", [list("bullet")]), "- [«one]{color=red}\n\n```\ncode»\n```");
  // The style goes into spans. What the paragraph already had inside it is kept: bold, a span of
  // its own, a colour over the block's, a link.
  assert.equal(one("**hel¦lo**\n{size=20pt color=red}", [list("bullet")]), "- [**hel¦lo**]{color=red size=20pt}");
  assert.equal(one("left [mid¦]{bg=yellow} right\n{color=red}", [list("bullet")]), "- [left ]{color=red}[mid¦]{bg=yellow color=red}[ right]{color=red}");
  assert.equal(one("left [mid¦]{color=blue} right\n{color=red}", [list("bullet")]), "- [left ]{color=red}[mid¦]{color=blue}[ right]{color=red}");
  assert.equal(one("see [th¦is](https://example.com) now\n{color=red}", [list("bullet")]), "- [see [th¦is](https://example.com) now]{color=red}");
  // Several lines, and text on either side that does not change.
  assert.equal(one("one\ntw¦o\n{color=red}", [list("bullet")]), "- [one\n  tw¦o]{color=red}");
  assert.equal(one("before\n\nhel¦lo\n{color=red}\n\nafter", [list("bullet")]), "before\n\n- [hel¦lo]{color=red}\n\nafter");
  // Every property a saved style has.
  assert.equal(one("«hello»", [{ type: "applyStyle", style: ALL }, list("bullet")]), "- [~~***«hello»***~~]{color=red bg=yellow font=serif size=20pt underline=yes}");
});

test("an empty line: a saved style with a list, in either order, then typing", () => {
  for (const [kind, mark] of [["bullet", "- "], ["ordered", "1. "], ["task", "- [ ] "]] as const) {
    assert.equal(one("¦", [{ type: "applyStyle", style: BIG }, list(kind), type("h"), type("i")]), `${mark}[**hi¦**]{size=20pt color=red}`, `style, then ${kind}`);
    assert.equal(one("¦", [list(kind), { type: "applyStyle", style: BIG }, type("h"), type("i")]), `${mark}[**hi¦**]{size=20pt color=red}`, `${kind}, then style`);
    assert.equal(one("¦", [{ type: "applyStyle", style: RED }, list(kind), type("h"), type("i")]), `${mark}[hi¦]{color=red}`, `a style with no size, then ${kind}`);
  }
});

test("after a block change the caret stays in its block, with other text below", () => {
  // A heading, a quote or a code block made normal text: at its start, in it and at its end.
  assert.equal(normal("### hello¦\n\nafter"), "hello¦\n\nafter");
  assert.equal(normal("### **hello¦**\n\nafter"), "**hello¦**\n\nafter");
  assert.equal(normal("## hel¦lo\n{color=red}\n\nafter"), "hel¦lo\n{color=red}\n\nafter", "the attribute line stays the paragraph's");
  assert.equal(normal("> hello¦\n\nafter"), "hello¦\n\nafter");
  assert.equal(normal("before\n\n> hel¦lo\n\nafter"), "before\n\nhel¦lo\n\nafter");
  assert.equal(normal("before\n\n### ¦hello\n\nafter"), "before\n\n¦hello\n\nafter");
  // A code block is left as it is (Enter on its empty last line is the way out of one).
  assert.equal(normal("```\nhello¦\n```\n\nafter"), "```\nhello¦\n```\n\nafter");
  // A styled paragraph made a list: at its start, in it and at its end, between other text.
  for (const [intent, mark] of [[list("bullet"), "- "], [list("ordered"), "1. "], [list("task"), "- [ ] "]] as const) {
    assert.equal(one("before\n\n¦hello\n{color=red}\n\nafter", [intent]), `before\n\n${mark}[¦hello]{color=red}\n\nafter`, `start, ${mark}`);
    assert.equal(one("before\n\nhel¦lo\n{color=red}\n\nafter", [intent]), `before\n\n${mark}[hel¦lo]{color=red}\n\nafter`, `middle, ${mark}`);
    assert.equal(one("before\n\nhello¦\n{color=red}\n\nafter", [intent]), `before\n\n${mark}[hello¦]{color=red}\n\nafter`, `end, ${mark}`);
  }
});

test("a look waiting at the caret is the line's too when a list is chosen", () => {
  const bold: Intent = { type: "setMark", change: { kind: "bold", on: true } };
  const green: Intent = { type: "setMark", change: { kind: "color", value: "green" } };
  // A look made with the toolbar at a caret (and shown as the selected style), then a list.
  assert.equal(one("hello¦", [bold, green, list("bullet")]), "- [**hello¦**]{color=green}");
  assert.equal(one("hello¦", [bold, green, list("bullet"), type("!")]), "- [**hello!¦**]{color=green}", "and it goes on for what is typed");
  // A saved style, with each list, and the caret anywhere in the line.
  assert.equal(one("hel¦lo", [{ type: "applyStyle", style: BIG }, list("bullet")]), "- [**hel¦lo**]{size=20pt color=red}");
  assert.equal(one("hello¦", [{ type: "applyStyle", style: RED }, list("bullet")]), "- [hello¦]{color=red}");
  assert.equal(one("hello¦", [{ type: "applyStyle", style: BIG }, list("task"), type("!")]), "- [ ] [**hello!¦**]{size=20pt color=red}");
  assert.equal(one("¦hello", [{ type: "applyStyle", style: BIG }, list("ordered")]), "1. [**¦hello**]{size=20pt color=red}");
  assert.equal(one("before\n\nhello¦\n\nafter", [{ type: "applyStyle", style: BIG }, list("bullet")]), "before\n\n- [**hello¦**]{size=20pt color=red}\n\nafter", "only its own line");
  // Out of a list as into one.
  assert.equal(one("- hello¦", [{ type: "applyStyle", style: RED }, list("none")]), "hello¦\n{color=red}");
  // Once the line has the look, nothing is left waiting: what is typed next takes it from the text.
  assert.deepEqual(steps("hello¦", [bold, green, list("bullet")]).doc.typing, { marks: [] });
  // Inline code is not a look for a line: it goes on waiting for what is typed.
  const code1: Intent = { type: "setMark", change: { kind: "code", on: true } };
  assert.equal(one("hello¦", [code1, list("bullet"), type("x")]), "- hello`x¦`");
  assert.equal(one("hello¦", [code1, bold, list("bullet"), type("x")]), "- **hello`x¦`**");
  // The list the line already is: the look is given all the same.
  assert.equal(one("- hello¦", [bold, list("bullet")]), "- **hello¦**");
  // A line that is only a picture has no look to take.
  assert.equal(one("![a](x.png)¦", [green, list("bullet")]), "- ![a](x.png)¦");
  // With no look waiting, the line is only its list item, and nothing is left waiting.
  const plain = reduce(parse("hello¦"), list("bullet"), "rich");
  assert.ok(plain.ok);
  assert.equal(plain.doc.text, "- hello");
  assert.deepEqual(plain.doc.typing, { marks: [] });
});

test("an image's width line is not taken for a style: the change is refused, as before", () => {
  for (const intent of [list("bullet"), list("ordered"), list("task")]) {
    const r = run("![a](x.png)¦\n{width=50%}", intent);
    assert.ok("refused" in r, `${JSON.stringify(intent)}: ${"out" in r ? r.out : ""}`);
  }
});

test("on an empty line the toolbar shows no look but the one waiting there", () => {
  const styled = "~~***hello***~~\n{font=serif size=20pt underline=yes color=purple bg=#fff176}";
  const at = (marked: string) => {
    const d = parse(marked);
    return describe(d, buildModel(d.text));
  };
  // In the styled line: its look.
  const inLine = at(`${styled.replace("hello", "hel¦lo")}\n\nafter`);
  assert.equal(inLine.bold, "on");
  assert.deepEqual(inLine.color, { mixed: false, value: "purple" });
  assert.deepEqual(inLine.size, { mixed: false, value: 20 });
  // At the very start of the styled line, before its markup: still its look, not the line's above.
  assert.equal(at(`plain\n\n¦${styled}`).bold, "on");
  assert.deepEqual(at(`plain\n\n¦${styled}`).color, { mixed: false, value: "purple" });
  // Before a list item's or a quote's mark: the item's own look. An empty item has none.
  assert.equal(at("- **a**\n¦- **b**").bold, "on");
  assert.equal(at("plain\n\n¦1. **b**").bold, "on");
  assert.equal(at("plain\n\n¦> **b**").bold, "on");
  assert.equal(at("- **a**\n- ¦").bold, "off");
  // On an empty line under it, straight below or further down, and above it: plain text at the note's size.
  for (const marked of [`${styled}\n\n¦`, `${styled}\n\n\n\n\n¦`, `${styled}\n\n¦\n\nafter`, `¦\n\n${styled}`]) {
    const st = at(marked);
    assert.equal(st.bold, "off", marked);
    assert.equal(st.italic, "off", marked);
    assert.deepEqual(st.color, { mixed: false, value: null }, marked);
    assert.deepEqual(st.bg, { mixed: false, value: null }, marked);
    assert.deepEqual(st.size, { mixed: false, value: 12 }, marked);
  }
  // What is typed there is plain, as the toolbar now says; a list chosen there is a plain list.
  assert.equal(one(`${styled}\n\n\n¦`, [type("x")]), `${styled}\n\n\nx¦`);
  assert.equal(one(`${styled}\n\n\n¦`, [list("bullet"), type("x")]), `${styled}\n\n\n- x¦`);
  // A look that waits there (a style picked on the empty line) is shown, and is what is typed.
  const waiting = steps(`${styled}\n\n\n¦`, [{ type: "applyStyle", style: BIG }]).doc;
  assert.equal(describe(waiting, buildModel(waiting.text)).bold, "on");
  assert.deepEqual(describe(waiting, buildModel(waiting.text)).size, { mixed: false, value: 20 });
  // The toolbar's state says nothing of a block style (SPEC-PLAIN 2).
  assert.equal("block" in at("# h¦"), false);
  assert.equal("block" in at("# h¦").can, false);
});

test("a list's shortcut typed in a look keeps the look for the text typed in it", () => {
  const out = (marked: string, intents: Intent[]) => show(edit(marked, intents));
  assert.equal(out("¦", [{ type: "applyStyle", style: RED }, ...typed("- hi")]), "- [hi¦]{color=red}");
  assert.equal(out("¦", [{ type: "applyStyle", style: BIG }, ...typed("[] hi")]), "- [ ] [**hi¦**]{color=red size=20pt}");
  assert.equal(out("¦", typed("- hi")), "- hi¦", "with no look, as before");
  // A quote's or a heading's mark typed in a look is text in that look.
  assert.equal(out("¦", [{ type: "applyStyle", style: RED }, ...typed("> hi")]), "\\> hi¦\n{color=red}");
  assert.equal(out("¦", [{ type: "applyStyle", style: BIG }, ...typed("# hi")]), "**\\# hi¦**\n{size=20pt color=red}");
});

// --- SPEC-PLAIN 5.1, 5.2, 5.5 ------------------------------------------------------------------

/** What the person sees of a note: its characters, block after block. */
const visible = (text: string) => {
  const m = buildModel(text);
  return m.blocks.map((_, i) => m.chars.filter((c) => c.block === i).map((c) => c.ch).join(""));
};
const kinds = (text: string) => buildModel(text).blocks.map((b) => `${b.info.kind}${b.info.path}`);

/** No heading, no code block and no quote in the note. */
function onlyNormalText(text: string, label: string): void {
  for (const b of buildModel(text).blocks) {
    assert.notEqual(b.info.kind, "heading", `${label}: a heading in ${JSON.stringify(text)}`);
    assert.notEqual(b.info.kind, "code", `${label}: a code block in ${JSON.stringify(text)}`);
    assert.ok(!b.info.path.includes("/quote"), `${label}: a quote in ${JSON.stringify(text)}`);
  }
}

test("5.1, 5.2: the marks of a heading, a quote and a code block, typed in Rich, are text", () => {
  for (const s of ["# x", "## x", "### x", "#### x", "###### x", "> x", "```x", "```", "~~~x", "# x"]) {
    // On an empty line; on an empty line under other text; in an empty list item.
    const alone = edit("¦", typed(s)).text;
    onlyNormalText(alone, s);
    assert.deepEqual(visible(alone), [s], `${JSON.stringify(s)} is shown as typed: ${JSON.stringify(alone)}`);
    const under = edit("intro\n\n¦", typed(s)).text;
    onlyNormalText(under, `${s}, under text`);
    assert.deepEqual(visible(under), ["intro", s], `${JSON.stringify(s)} under text: ${JSON.stringify(under)}`);
    const item = edit("- ¦", typed(s)).text;
    onlyNormalText(item, `${s}, in a list item`);
    assert.deepEqual(visible(item), [s], `${JSON.stringify(s)} in a list item: ${JSON.stringify(item)}`);
    assert.deepEqual(kinds(item), ["paragraph/list:bullet/item:0"], `${s}: the item is still one item`);
  }
  // A code block's line after its mark: Enter makes a paragraph, not the block's first line.
  const fence = edit("¦", [...typed("```"), { type: "enter" }, ...typed("x"), { type: "enter" }, ...typed("```")]).text;
  onlyNormalText(fence, "a fence, a line and a fence");
  assert.deepEqual(visible(fence), ["```", "x", "```"]);
});

test("5.2: a line of === or --- typed under text does not make a heading", () => {
  /** Each intent in turn, with its `then`; a refusal leaves the note as it was. Never a heading. */
  const never = (marked: string, intents: Intent[]) => {
    let doc = parse(marked);
    assert.ok(buildModel(doc.text).blocks.every((b) => b.info.kind !== "heading"), `${marked} starts with no heading`);
    for (const i of intents) {
      const r = run(doc, i);
      if ("out" in r) doc = r.doc;
      onlyNormalText(doc.text, `${JSON.stringify(marked)}, after ${JSON.stringify(i)}`);
    }
    return doc.text;
  };
  const enter: Intent = { type: "enter" };
  const br: Intent = { type: "lineBreak" };
  const back: Intent = { type: "deleteBackward" };
  const del: Intent = { type: "deleteForward" };
  for (const line of ["===", "---", "=", "-", "= = =", "- - -", "=======", "-------"]) {
    // Title, Enter, the line: a paragraph of its own (or, for dashes, text), and the two joined again.
    const text = never("¦", [...typed("Title"), enter, ...typed(line)]);
    assert.equal(visible(text)[0], "Title", line);
    // Title, a line break, the line: the same paragraph.
    never("¦", [...typed("Title"), br, ...typed(line)]);
    never("Title ¦x", [br, ...typed(line), del]);
    never("Title ¦x", [br, del, ...typed(line)]);
    // A paragraph of two lines that is already there: its second line typed over, or emptied and typed.
    never("Title\n«x»", typed(line));
    never("Title\\\n«x»", typed(line));
    never("Title\n¦x", [...typed(line), del]);
    never("Title\nx¦", [back, ...typed(line)]);
    // The line as a paragraph under the text, joined to it by Backspace or Delete.
    never("Title\n\n¦", [...typed(line), ...[...line].map(() => back), back, back, ...typed(line)]);
    never("Title¦\n\nx", [del, del, ...typed(line)]);
    // Pasted under the text.
    for (const paste of [{ type: "paste", plain: line }, { type: "paste", plain: line, markdown: line }, { type: "paste", plain: `Title\n${line}`, markdown: `Title\n${line}` }] as Intent[]) {
      never("Title\n«x»", [paste]);
      never("Title\\\n«x»", [paste]);
      never("Title\n\n¦", [paste, back]);
      never("¦", [paste]);
    }
  }
  // What is written, for the plainest case: the line is there as typed.
  assert.deepEqual(visible(never("¦", [...typed("Title"), enter, ...typed("===")])), ["Title", "==="]);
  assert.deepEqual(visible(never("¦", [...typed("Title"), enter, ...typed("---")])), ["Title", "---"]);
});

test("5.1: a heading, a quote or a code block pasted in Rich is plain lines", () => {
  const cases: [name: string, markdown: string, words: string[]][] = [
    ["a heading", "# head", ["head"]],
    ["a level 3 heading", "### head", ["head"]],
    ["a quote", "> quoted", ["quoted"]],
    ["a code block", "```\ncode\n```", ["code"]],
    ["a code block with a language", "```js\ncode\n```", ["code"]],
    ["a code block of tildes", "~~~\ncode\n~~~", ["code"]],
    ["a heading by its underline", "head\n===", ["head"]],
    ["all three among text", "one\n\n# head\n\n> quoted\n\n```\ncode\n```\n\ntwo", ["one", "head", "quoted", "code", "two"]],
    ["a quote in a list", "- > quoted\n- two", ["quoted", "two"]],
  ];
  for (const [name, markdown, words] of cases) {
    for (const marked of ["¦", "intro\n\n¦", "one ¦two", "one «gone» two", "- ¦", "- item ¦here"]) {
      for (const intent of [{ type: "paste", plain: markdown, markdown }, { type: "paste", plain: markdown }] as Intent[]) {
        const label = `${name} pasted ${"markdown" in intent ? "as Markdown" : "as plain text"} into ${JSON.stringify(marked)}`;
        const r = run(marked, intent);
        if ("refused" in r) continue;
        onlyNormalText(r.doc.text, label);
        const seen = visible(r.doc.text).join("\n");
        for (const w of words) assert.ok(seen.includes(w), `${label}: ${JSON.stringify(w)} is in ${JSON.stringify(r.doc.text)}`);
        assert.ok(!seen.includes("gone"), `${label}: the selection was replaced`);
      }
    }
  }
  // The three named by the rule are not refused, on an empty line or in the middle of a paragraph.
  for (const markdown of ["# head", "> quoted", "```\ncode\n```"]) {
    for (const marked of ["¦", "one ¦two"]) {
      const r = run(marked, { type: "paste", plain: markdown, markdown });
      assert.ok("out" in r, `${JSON.stringify(markdown)} into ${JSON.stringify(marked)}: ${"refused" in r ? r.refused : ""}`);
      onlyNormalText(r.doc.text, markdown);
    }
  }
  assert.equal(show(edit("¦", [{ type: "paste", plain: "# head", markdown: "# head" }])), "\\# head¦");
  assert.equal(show(edit("¦", [{ type: "paste", plain: "> quoted", markdown: "> quoted" }])), "\\> quoted¦");
  assert.deepEqual(visible(edit("¦", [{ type: "paste", plain: "```\ncode\n```", markdown: "```\ncode\n```" }]).text), ["```", "code", "```"]);
  // A list pasted as Markdown is still a list.
  assert.equal(show(edit("¦", [{ type: "paste", plain: "one\ntwo", markdown: "- one\n- **two**" }])), "- one\n- **two**¦");
});

test("5.1: the shortcut intent is refused after a heading's or a quote's mark, and makes a list after a list's", () => {
  /** The characters typed one at a time with no `then`: the text as it is when `shortcut` arrives. */
  const before = (s: string) => steps("¦", typed(s)).doc;
  for (const s of ["# ", "## ", "#### ", "> ", "```"]) {
    const doc = before(s);
    const typedLast = reduce(steps("¦", typed(s.slice(0, -1))).doc, type(s.slice(-1)), "rich");
    assert.ok(typedLast.ok);
    assert.equal(typedLast.then, undefined, `${JSON.stringify(s)}: no shortcut is asked for`);
    const r = reduce(doc, { type: "shortcut" }, "rich");
    assert.ok(!r.ok, `${JSON.stringify(s)}: expected a refusal, got ${r.ok ? JSON.stringify(show(r.doc)) : ""}`);
    assert.match(r.reason, /no shortcut/);
  }
  for (const [s, after] of [["- ", "- ¦"], ["* ", "- ¦"], ["1. ", "1. ¦"], ["[] ", "- [ ] ¦"]] as const) {
    const typedLast = reduce(steps("¦", typed(s.slice(0, -1))).doc, type(" "), "rich");
    assert.ok(typedLast.ok);
    assert.deepEqual(typedLast.then, { type: "shortcut" }, `${JSON.stringify(s)}: the shortcut is the second step`);
    const r = reduce(before(s), { type: "shortcut" }, "rich");
    assert.ok(r.ok, `${JSON.stringify(s)}: ${r.ok ? "" : r.reason}`);
    assert.equal(show(r.doc), after, s);
  }
  // Written by hand as the editor leaves them.
  for (const marked of ["\\# ¦", "\\> ¦", "\\# ¦text", "plain¦"]) {
    const r = run(marked, { type: "shortcut" });
    assert.ok("refused" in r, marked);
    assert.match(r.refused, /no shortcut/, marked);
  }
});

test("5.5: a heading, a quote and a code block already in a note are not rewritten by an edit elsewhere", () => {
  const OLD = "## Head ##\n{color=red}\n\n> quoted **bold**\n> second line\n\n```js\ncode  \n\n# not a heading\n```";
  const blocks = (text: string) => kinds(text).filter((k) => /^heading|^code|\/quote/.test(k));
  assert.deepEqual(blocks(OLD), ["heading", "paragraph/quote", "code"], "the note has the three");
  const edits: [name: string, intent: Intent][] = [
    ["typing", type("x")],
    ["a kept space", type(" ")],
    ["Enter", { type: "enter" }],
    ["Backspace", { type: "deleteBackward" }],
    ["Delete", { type: "deleteForward" }],
    ["bold waiting", { type: "setMark", change: { kind: "bold", on: true } }],
    ["a saved style", { type: "applyStyle", style: BIG }],
    ["a list", list("bullet")],
    ["a paste", { type: "paste", plain: "# head", markdown: "# head" }],
    ["a horizontal line", { type: "insertBlock", what: "rule" }],
  ];
  let done = 0;
  for (const [name, intent] of edits) {
    // In a paragraph under the three, above them, and between two copies of them.
    for (const para of ["pa¦ra", "«para»", "para¦"]) {
      for (const [where, marked] of [["under", `${OLD}\n\n${para}`], ["above", `${para}\n\n${OLD}`], ["between", `${OLD}\n\n${para}\n\n${OLD}`]] as const) {
        const r = run(marked, intent);
        if ("refused" in r) continue;
        done++;
        const t = r.doc.text;
        const label = `${name} ${where} (${para}): ${JSON.stringify(t)}`;
        if (where !== "above") assert.equal(t.slice(0, OLD.length + 2), `${OLD}\n\n`, label);
        if (where !== "under") assert.equal(t.slice(t.length - OLD.length - 2), `\n\n${OLD}`, label);
        assert.deepEqual(blocks(t), where === "between" ? [...blocks(OLD), ...blocks(OLD)] : blocks(OLD), label);
      }
    }
  }
  assert.ok(done >= 60, `${done} edits were made`);
  // The plainest case, in full.
  assert.equal(show(edit(`${OLD}\n\npara¦`, [type("x")])), `${OLD}\n\nparax¦`);
  assert.equal(show(edit(`pa¦ra\n\n${OLD}`, [type("x")])), `pax¦ra\n\n${OLD}`);
});

test("an intent the core no longer has is refused, not thrown", () => {
  const r = reduce(parse("hello¦"), { type: "setBlock", kind: "h2" } as unknown as Intent, "rich");
  assert.equal(r.ok, false);
});
