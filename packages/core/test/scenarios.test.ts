// SPEC2 12, `core` scenarios: every intent through `reduce`; every row of both tables of 7.5;
// every bullet of 7.6 and row of 7.2 marked new; every `tableEdit`; an edit outside its region
// refused. Text with a caret marker `¦` (or a selection `«…»`), an intent, the expected text
// and caret. Rows marked "new" record what the routine does today (7.5).

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel, checkRegion, describe, describeCell, PLAIN, reduce, type Change, type Intent, type Mode, type SavedStyle, type Typing } from "../src/index.ts";
import { parse, run, show } from "./scenario.ts";

type Case = [before: string, intent: Intent, after: string | { refused: RegExp }, note?: string];

function check(cases: Case[], mode: Mode = "rich", typing?: Typing) {
  for (const [before, intent, after, note] of cases) {
    const r = run(typing ? parse(before, typing) : before, intent, mode);
    const label = `${JSON.stringify(before)} + ${JSON.stringify(intent)}${note ? ` (${note})` : ""}`;
    if (typeof after === "string") {
      assert.ok("out" in r, `${label}: refused: ${"refused" in r ? r.refused : ""}`);
      assert.equal(r.out, after, label);
    } else {
      assert.ok("refused" in r, `${label}: expected a refusal, got ${"out" in r ? JSON.stringify(r.out) : ""}`);
      assert.match(r.refused, after.refused, label);
    }
  }
}

/** Types each character in turn, with its `then`, as the editor does. */
function typeAll(marked: string, s: string): string {
  let doc = parse(marked);
  for (const ch of s) {
    const r = run(doc, { type: "insertText", text: ch });
    assert.ok("out" in r, `typing ${JSON.stringify(ch)} into ${JSON.stringify(show(doc))}: ${"refused" in r ? r.refused : ""}`);
    doc = r.doc;
  }
  return show(doc);
}

const B: Change = { kind: "bold", on: true };
const STYLE: SavedStyle = { name: "Loud", bold: true, italic: false, underline: false, strike: false, size: 14, font: null, color: "red", bg: null };

test("7.5 Enter, by block and caret", () => {
  check([
    ["Para one¦", { type: "enter" }, "Para one\n\n¦", "paragraph, end"],
    ["Para one¦\n{color=red}", { type: "enter" }, "Para one\n{color=red}\n\n¦", "paragraph, end: after the attribute line"],
    ["Para ¦one", { type: "enter" }, "Para\n\n¦one", "paragraph, inside: the space at the split is dropped"],
    ["**bo¦ld** x", { type: "enter" }, "**bo**\n\n**¦ld** x", "inline markup closed and reopened"],
    ["Spl¦it\n{color=red}", { type: "enter" }, "Spl\n{color=red}\n\n¦it\n{color=red}", "both halves keep the attribute line"],
    ["# Tit¦le", { type: "enter" }, "# Tit\n\n# ¦le", "heading, inside: two headings"],
    ["# Title¦", { type: "enter" }, "# Title\n\n¦", "heading, end: what is typed next is a paragraph"],
    ["> quo¦ted", { type: "enter" }, "> quo\n>\n> ¦ted", "quote: a new paragraph inside the quote"],
    ["- one¦", { type: "enter" }, "- one\n- ¦", "list item, end"],
    ["- o¦ne", { type: "enter" }, "- o\n- ¦ne", "list item, inside"],
    ["1. one¦", { type: "enter" }, "1. one\n2. ¦", "numbered: the next number"],
    ["- [x] one¦", { type: "enter" }, "- [x] one\n- [ ] ¦", "a task starts unticked"],
    ["- ¦one", { type: "enter" }, "-\n- ¦one", "new: list item, start: an empty item above, the caret stays with the text"],
    ["- one\n- ¦", { type: "enter" }, "- one\n¦", "empty item: ends the list"],
    ["- one\n- [ ] ¦", { type: "enter" }, "- one\n¦", "empty task: ends the list"],
    ["```\nco¦de\n```", { type: "enter" }, "```\nco\n¦de\n```", "code: a new line inside"],
    ["```\ncode\n¦\n```", { type: "enter" }, "```\ncode\n```\n\n¦", "new: code, empty last line: leaveCode"],
    ["¦# Title", { type: "enter" }, "\n¦# Title", "new: the start of a heading"],
    ["> ¦quoted", { type: "enter" }, "> \n>\n> ¦quoted", "new: the start of a quote"],
    ["> one\n>\n> ¦", { type: "enter" }, "> one\n>\n¦", "new: an empty quote line"],
    ["a «b» c", { type: "enter" }, "a\n\n¦c", "a selection is deleted first"],
  ]);
});

test("7.5 Backspace at the start, by block", () => {
  check([
    ["# ¦Title", { type: "deleteBackward" }, "¦Title", "heading becomes a paragraph"],
    ["> ¦quoted", { type: "deleteBackward" }, "¦quoted", "quote becomes a paragraph"],
    ["- ¦one\n- two", { type: "deleteBackward" }, "¦one\n\n- two", "list item: a paragraph, with a blank line where the list goes on"],
    ["- one\n- ¦", { type: "deleteBackward" }, "- one\n¦", "new: empty item: the marker is removed"],
    ["```\n¦code\n```", { type: "deleteBackward" }, { refused: /end the code block/ }, "new: code, first character: refused"],
    ["```\nco¦de\n```", { type: "deleteBackward" }, "```\nc¦de\n```", "new: code: plain delete"],
    ["```\ncode\n¦\n```", { type: "deleteBackward" }, "```\ncode¦\n```", "new: code, empty last line: plain delete"],
  ]);
});

test("7.5 Backspace at the start of a paragraph, by what is above", () => {
  check([
    ["¦First", { type: "deleteBackward" }, "¦First", "nothing above"],
    ["Above\n\n¦Below", { type: "deleteBackward" }, "Above¦Below", "paragraph"],
    ["# Head\n\n¦Below", { type: "deleteBackward" }, "# Head¦Below", "heading"],
    ["> q\n\n¦Below", { type: "deleteBackward" }, "> q¦Below", "quote"],
    ["- i\n\n¦Below", { type: "deleteBackward" }, "- i¦Below", "list item"],
    ["Above\n{color=red}\n\n¦Below", { type: "deleteBackward" }, { refused: /cannot be joined/ }, "the block above has an attribute line"],
    ["---\n\n¦Below", { type: "deleteBackward" }, "¦Below", "horizontal line: removed"],
    ["```\ncode\n```\n\n¦Below", { type: "deleteBackward" }, { refused: /code block cannot be joined/ }, "new: code block"],
    ["Above\n\n| a | b |\n|---|---|\n| c | d |\n\n¦Below", { type: "deleteBackward" }, { refused: /cannot be joined/ }, "new: table with a block above: refused"],
    ["| a | b |\n|---|---|\n| c | d |\n\n¦Below", { type: "deleteBackward" }, "| a | b |\n|---|---|\n| c | d |\n\n¦Below", "new: table with nothing above: nothing"],
  ]);
});

test("7.5 Delete at the end of a block (new), Shift+Enter", () => {
  check([
    ["Above¦\n\n# Head", { type: "deleteForward" }, "Above¦Head", "new: a heading below is joined"],
    ["Above¦\n\n---\n\nx", { type: "deleteForward" }, "Above\n\n¦---\n\nx", "new: a line below: the caret moves to it (SPEC-NOTES)"],
    ["Last¦", { type: "deleteForward" }, "Last¦", "new: nothing below"],
    ["a ¦![](note.assets/p.png) b", { type: "deleteForward" }, "a ¦ b", "a photo is deleted like any character"],
    ["one tw¦o", { type: "lineBreak" }, "one tw\\\n¦o", "paragraph: a hard break"],
    ["- one tw¦o", { type: "lineBreak" }, "- one tw\\\n  ¦o", "list item"],
    ["> one tw¦o", { type: "lineBreak" }, "> one tw\\\n> ¦o", "quote line"],
    ["```\nco¦de\n```", { type: "lineBreak" }, "```\nco\n¦de\n```", "code: a new line"],
    ["x\n\n¦", { type: "lineBreak" }, "x\n\n\n¦", "empty line: as Enter"],
    ["# Ti¦tle", { type: "lineBreak" }, { refused: /line break goes in a paragraph/ }, "heading: refused"],
    ["¦one two", { type: "lineBreak" }, { refused: /between words/ }, "start of a paragraph: refused"],
    ["one two¦", { type: "lineBreak" }, { refused: /between words/ }, "end of a paragraph: refused"],
  ]);
});

test("7.6 typing is literal; typed text keeps the style around it", () => {
  check([
    ["a¦", { type: "insertText", text: "*" }, "a*¦"],
    ["¦", { type: "insertText", text: "#" }, "\\#¦"],
    ["**bold**¦ x", { type: "insertText", text: "y" }, "**boldy¦** x", "the style of the character before"],
    ["¦**bold**", { type: "insertText", text: "y" }, "**y¦bold**", "at a block's start, the one after"],
    ["one «two» three", { type: "insertText", text: "X" }, "one X¦ three", "replaces the selection"],
    ["one ¦three", { type: "insertText", text: "a\nb" }, "one a\n\nb¦three", "with a line break: pastePlain"],
    // Bug found by the e2e composition journey: typing over a selection at a paragraph's start
    // lost the space after it (version 1 gave " xthere").
    ["«Hi» there", { type: "insertText", text: "x" }, "x¦ there", "bug: over a selection at a block's start"],
    ["**«Hi»** there", { type: "insertText", text: "x" }, "**x¦** there", "over a selection inside bold: the selection's style"],
    ["one «two» three", { type: "insertText", text: "x" }, "one x¦ three"],
  ]);
  assert.equal(typeAll("Issue ¦", "#12"), "Issue #12¦");
});

test("7.6 line-start shortcuts become the block, as `then`", () => {
  assert.equal(typeAll("¦", "# Title"), "# Title¦");
  assert.equal(typeAll("¦", "#### Four"), "#### Four¦");
  assert.equal(typeAll("¦", "- item"), "- item¦");
  assert.equal(typeAll("¦", "* item"), "- item¦");
  assert.equal(typeAll("¦", "1. first"), "1. first¦");
  assert.equal(typeAll("¦", "[] task"), "- [ ] task¦");
  assert.equal(typeAll("¦", "> quoted"), "> quoted¦");
  assert.equal(typeAll("¦", "```"), "```\n¦\n```");
  assert.equal(typeAll("x¦", " # y"), "x # y¦", "in the middle of a line they are literal");
  // The typed characters go in first as literal text; the shortcut is a second step.
  const r = reduce(parse("\\#¦"), { type: "insertText", text: " " }, "rich");
  assert.ok(r.ok);
  assert.equal(show(r.doc), "\\# ¦");
  assert.deepEqual(r.then, { type: "shortcut" });
  check([["\\# ¦", { type: "shortcut" }, "# ¦"], ["plain¦", { type: "shortcut" }, { refused: /no shortcut/ }]]);
});

test("7.4.3 typing: marks and block wait for the next typed text", () => {
  const bold: Typing = { marks: [B], block: null };
  check([["one ¦", { type: "insertText", text: "x" }, "one **x¦**"]], "rich", bold);
  // A space typed alone leaves `typing` waiting.
  let r = reduce(parse("one¦", bold), { type: "insertText", text: " " }, "rich");
  assert.ok(r.ok);
  assert.deepEqual(r.doc.typing, bold);
  // Any other change clears it.
  r = reduce(parse("one¦", bold), { type: "deleteBackward" }, "rich");
  assert.ok(r.ok);
  assert.deepEqual(r.doc.typing, { marks: [], block: null });
  check([["¦", { type: "insertText", text: "T" }, "## T¦"]], "rich", { marks: [], block: "h2" });
  check([["¦", { type: "insertText", text: "x" }, "```\nx¦\n```"]], "rich", { marks: [], block: "code" });
  r = reduce(parse("a¦", { marks: [], block: "h2" }), { type: "insertText", text: " " }, "rich");
  assert.ok(r.ok);
  assert.equal(r.doc.typing.block, "h2", "a space typed alone also leaves typing.block waiting");
});

test("7.4.3 Enter carries the style on (styleToCarry)", () => {
  const carry = (marked: string, typing?: Typing) => {
    const r = reduce(parse(marked, typing), { type: "enter" }, "rich");
    assert.ok(r.ok);
    return r.doc.typing.marks;
  };
  assert.deepEqual(carry("**bold**¦"), [{ kind: "bold", on: true }], "the style of the character before, at the end");
  assert.deepEqual(carry("**bo¦ld**"), [], "only at the end of the paragraph");
  assert.deepEqual(carry("# **Head**¦"), [], "no bold in a heading, no size in a heading");
  assert.deepEqual(carry("[++link++](https://e.com)¦"), [], "no underline on a link");
  assert.deepEqual(carry("`code`¦"), [], "nothing out of code");
  assert.deepEqual(carry("[big]{size=18pt}¦"), [{ kind: "size", pt: 18 }]);
  assert.deepEqual(carry("---\nsize: 18pt\n---\n[big]{size=18pt}¦"), [], "no size equal to the note's");
  assert.deepEqual(carry("plain¦", { marks: [{ kind: "italic", on: true }], block: null }), [{ kind: "italic", on: true }], "the waiting marks first");
});

test("setMark, applyStyle and setLink (7.3, 7.6, 9.4)", () => {
  check([
    ["one «two» three", { type: "setMark", change: B }, "one **«two»** three"],
    ["one »two« three", { type: "setMark", change: B }, "one **»two«** three", "a backward selection stays backward"],
    ["«one» two", { type: "setMark", change: { kind: "size-step", dir: 1 } }, "[«one»]{size=13pt} two", "size step: one point"],
    ["one «two»", { type: "setMark", change: { kind: "size", pt: 500 } }, { refused: /1 to 400/ }],
    ["«**b** x»", { type: "setMark", change: { kind: "bold", on: false } }, "«b x»"],
    ["«b» `c`", { type: "setMark", change: { kind: "clear" } }, "«b» `c`", "nothing to clear: nothing changes"],
    ["«[r]{color=red}»", { type: "setMark", change: { kind: "clear" } }, "«r»"],
    ["«one»", { type: "setLink", href: "https://e.com" }, "[«one»](https://e.com)"],
    ["«one»", { type: "setLink", href: "javascript:x" }, { refused: /https/ }],
    ["one¦", { type: "setLink", href: "https://e.com" }, { refused: /Select some text first/ }, "Ctrl+K with nothing selected"],
    ["«[one](https://e.com)»", { type: "setLink", href: null }, "«one»", "remove"],
    ["«[one](https://e.com)»", { type: "setLink", href: "https://f.org" }, "[«one»](https://f.org)", "edit"],
    ["«one» two", { type: "applyStyle", style: STYLE }, "[**«one»**]{size=14pt color=red} two", "several changes as one edit"],
    ["«**one**» two", { type: "applyStyle", style: "reset" }, "«one» two", "Default (reset) with a selection clears"],
  ]);
  // With nothing selected: typing.marks, and no text change.
  const marks = (marked: string, intent: Intent) => {
    const r = reduce(parse(marked), intent, "rich");
    assert.ok(r.ok);
    assert.equal(r.edit, null);
    return r.doc.typing.marks;
  };
  assert.deepEqual(marks("one ¦two", { type: "setMark", change: B }), [B]);
  assert.deepEqual(marks("one¦", { type: "setMark", change: { kind: "size-step", dir: -1 } }), [{ kind: "size", pt: 11 }], "the shown size minus 1");
  assert.deepEqual(marks("# Head¦", { type: "setMark", change: { kind: "size-step", dir: 1 } }), [{ kind: "size", pt: 25 }]);
  assert.equal(marks("one¦", { type: "applyStyle", style: STYLE }).length, 8);
  assert.deepEqual(marks("# Head¦", { type: "applyStyle", style: "reset" }).find((c) => c.kind === "size"), { kind: "size", pt: 24, own: true }, "reset keeps a heading's size (a size that is the block's own)");
  // Value, not toggle: on twice is on.
  const once = reduce(parse("one «two»"), { type: "setMark", change: B }, "rich");
  assert.ok(once.ok);
  const twice = reduce(once.doc, { type: "setMark", change: B }, "rich");
  assert.ok(twice.ok);
  assert.equal(twice.doc.text, once.doc.text);
});

test("7.4.5 Raw mode: the toolbar's intents work on the same text; typing is plain", () => {
  check(
    [
      ["one «two» x", { type: "setMark", change: B }, "one **«two»** x"],
      ["one ¦two", { type: "setMark", change: B }, { refused: /^Select some text first$/ }],
      ["one¦", { type: "applyStyle", style: STYLE }, { refused: /Select some text first/ }],
      ["abc¦", { type: "insertText", text: "*" }, "abc*¦"],
      ["abc¦", { type: "enter" }, "abc\n¦"],
      ["abc¦", { type: "deleteBackward" }, "ab¦"],
      ["a¦bc", { type: "deleteForward" }, "a¦c"],
      ["x\n\n¦", { type: "setBlock", kind: "h2" }, "x\n\n## ¦", "no typing: the marks at once"],
      ["x\n\n¦", { type: "setBlock", kind: "code" }, "x\n\n```\n¦\n```"],
      ["```\ncode\n¦\n```", { type: "setBlock", kind: "h3" }, "```\ncode\n```\n\n### ¦"],
      ["Text¦", { type: "setList", kind: "bullet" }, "- Text¦"],
      ["one ¦two", { type: "paste", plain: "*x*" }, "one *x*¦two"],
    ],
    "raw",
  );
});

test("7.6 block styles exclude each other (7.2 new)", () => {
  check([
    ["Text¦", { type: "setBlock", kind: "h2" }, "## Text¦"],
    ["## Text¦", { type: "setBlock", kind: "h2" }, "## Text¦", "already: nothing changes"],
    ["## Text¦", { type: "setBlock", kind: "quote" }, "> Text¦", "the heading goes first"],
    ["> ## Text¦", { type: "setBlock", kind: "h1" }, "# Text¦", "quote and heading both go first"],
    ["## Text¦", { type: "setBlock", kind: "paragraph" }, "Text¦"],
    ["Text¦", { type: "setBlock", kind: "code" }, "```\nText¦\n```", "the caret stays after the text, not on the closing fence's line"],
    ["```\nco¦de\n```", { type: "setBlock", kind: "h2" }, "## co¦de", "inside a code block, another style converts it"],
    ["```\nco¦de\n```", { type: "setBlock", kind: "paragraph" }, "co¦de"],
    ["```\ncode\n¦\n```", { type: "setBlock", kind: "quote" }, "```\ncode\n```\n\n¦", "on its empty line: leaveCode"],
    ["```\na\n\nb¦\n```", { type: "setBlock", kind: "h1" }, "```\na\n\nb\n```\n\n¦", "cannot be converted: leaveCode"],
  ]);
  const r = reduce(parse("x\n\n¦"), { type: "setBlock", kind: "h2" }, "rich");
  assert.ok(r.ok && r.doc.typing.block === "h2" && r.edit === null, "on an empty line it becomes typing.block");
  const c = reduce(parse("```\ncode\n¦\n```"), { type: "setBlock", kind: "quote" }, "rich");
  assert.ok(c.ok && c.doc.typing.block === "quote", "after leaving a code block the style is typing.block");
});

test("7.6 lists (7.2 new): markers on empty lines, values not toggles", () => {
  check([
    ["Text¦", { type: "setList", kind: "bullet" }, "- Text¦"],
    ["- Text¦", { type: "setList", kind: "bullet" }, "- Text¦", "setList(bullet) on a bullet changes nothing"],
    ["- Text¦", { type: "setList", kind: "none" }, "Text¦", "No list"],
    ["- Text¦", { type: "setList", kind: "ordered" }, "1. Text¦"],
    ["- Text¦", { type: "setList", kind: "task" }, "- [ ] Text¦"],
    ["Para\n¦", { type: "setList", kind: "bullet" }, "Para\n\n- ¦", "a blank line next to plain text"],
    ["1. one\n¦", { type: "setList", kind: "ordered" }, "1. one\n2. ¦", "a numbered item continues from the item above"],
    ["- ¦", { type: "setList", kind: "task" }, "- [ ] ¦", "an empty item: the marker changes"],
    ["- ¦", { type: "setList", kind: "none" }, "¦", "an empty item: the marker goes"],
    ["¦", { type: "setList", kind: "none" }, "¦"],
    ["¦", { type: "setList", kind: "bullet" }, "- ¦"],
    ["«a\n\nb»", { type: "setList", kind: "ordered" }, "1. «a\n2. b»"],
    ["- «a\n- b»", { type: "setList", kind: "none" }, "«a\n\nb»"],
  ]);
});

test("Insert, photos, widgets (7.6)", () => {
  check([
    ["One¦\n\nTwo", { type: "insertBlock", what: "table" }, "One\n\n| «Column 1» | Column 2 |\n|---|---|\n| | |\n\nTwo", "after the caret's block"],
    ["One\n\n¦", { type: "insertBlock", what: "table" }, "One\n\n| «Column 1» | Column 2 |\n|---|---|\n| | |\n\n", "at the caret's empty line; an empty line follows a table that ends the note"],
    ["One¦\n\nTwo", { type: "insertBlock", what: "rule" }, "One\n\n---\n\n¦\n\nTwo", "after a line, the caret is on a new empty line"],
    ["One¦\n\nTwo", { type: "insertPhoto", file: "cat.png" }, "One\n\n![](note.assets/cat.png)¦\n\nTwo"],
    ["One¦", { type: "insertPhoto", file: "../x.png" }, { refused: /photo name/ }],
    ["![](note.assets/cat.png)\n\nT¦", { type: "setImageWidth", at: 0, value: 40 }, "![](note.assets/cat.png)\n{width=40%}\n\nT¦"],
    ["![](note.assets/cat.png)\n{width=40%}\n\nT¦", { type: "setImageWidth", at: 0, value: 73 }, "![](note.assets/cat.png)\n{width=73%}\n\nT¦", "any whole percentage"],
    ["![](note.assets/cat.png)\n\nT¦", { type: "setImageWidth", at: 0, value: 4 }, { refused: /5 to 100/ }],
    ["![](note.assets/cat.png)\n\nT¦", { type: "setImageWidth", at: 0, value: 33.5 }, { refused: /whole percentage/ }],
    ["T¦ ![](note.assets/cat.png)", { type: "setImageWidth", at: 2, value: 50 }, { refused: /line of its own/ }],
    ["- [ ] milk\n- [x] eggs¦", { type: "toggleTask", at: 2 }, "- [x] milk\n- [x] eggs¦"],
    ["- [ ] milk\n- [x] eggs¦", { type: "toggleTask", at: 13 }, "- [ ] milk\n- [ ] eggs¦"],
    ["plain¦", { type: "toggleTask", at: 0 }, { refused: /no task/ }],
  ]);
});

test("setMeta (7.6): writeSetting, with titles and tags cleaned first (7.2 new)", () => {
  check([
    ["Hello¦", { type: "setMeta", key: "title", value: "  My\nnote  " }, "---\ntitle: My note\n---\nHello¦", "cleaned; a block is added"],
    ["---\ntitle: X\n---\n\nHello¦", { type: "setMeta", key: "title", value: " " }, "\nHello¦", "an empty title removes the key, and the last key the block"],
    ["---\ntitle: X\n---\n\nHello¦", { type: "setMeta", key: "tags", value: ["Work", "home!", "x y"] }, "---\ntitle: X\ntags: [work, home, xy]\n---\n\nHello¦", "lower-case a-z, a flow list"],
    ["---\ntags: [a-b, c]\n---\n\nHello¦", { type: "setMeta", key: "tags", value: ["a-b"] }, "---\ntags: [a-b]\n---\n\nHello¦", "a hand-written tag is kept as written and can be removed"],
    ["---\ntitle: X\n---\n\nHello¦", { type: "setMeta", key: "font", value: "sans" }, "---\ntitle: X\nfont: sans\n---\n\nHello¦"],
    ["---\ntitle: X\n---\n\nHello¦", { type: "setMeta", key: "size", value: "14pt" }, "---\ntitle: X\nsize: 14pt\n---\n\nHello¦"],
    ["---\n: [\n---\n\nHello¦", { type: "setMeta", key: "title", value: "x" }, { refused: /front matter does not parse/ }, "broken front matter"],
    ["---\ntitle: |\n  long\n---\n\nHello¦", { type: "setMeta", key: "title", value: "x" }, { refused: /several lines/ }],
  ]);
  const t = "a".repeat(400);
  const r = run("x¦", { type: "setMeta", key: "title", value: t });
  assert.ok("out" in r && r.out.includes(`title: ${"a".repeat(300)}\n`), "cut to 300 characters");
});

test("cut, paste, deletes", () => {
  check([
    ["one «two» three", { type: "cut" }, "one ¦ three"],
    ["one «**two**» three", { type: "cut" }, "one ¦ three"],
    ["one ¦three", { type: "paste", plain: "a\nb" }, "one a\n\nb¦three", "plain: one paragraph per line"],
    ["one ¦three", { type: "paste", plain: "*x*" }, "one \\*x\\*¦three", "plain is literal"],
    ["one ¦three", { type: "paste", plain: "*x*", markdown: "**x**" }, "one **x¦**three", "the app's own type keeps formatting"],
    ["one tw¦o", { type: "deleteWordBackward" }, "one ¦o"],
    ["one ¦two", { type: "deleteWordForward" }, "one ¦"],
    ["**ab¦**", { type: "deleteBackward" }, "**a¦**"],
    ["**a¦**", { type: "deleteBackward" }, "¦", "hidden markup goes with the last character"],
  ]);
});

const T = "Intro\n\n| a | b |\n|---|---|\n| c | d |\n\nAfter¦";
const R = (text: string, style: Partial<typeof PLAIN> = {}) => [{ text, style: { ...PLAIN, ...style } }];
const AT = 8;

test("tableEdit (7.7): every operation", () => {
  const out = (cells: string) => `Intro\n\n${cells}\n\nAfter¦`;
  check([
    [T, { type: "tableEdit", at: AT, op: { op: "setCell", row: 1, col: 0, runs: R("new") } }, out("| a | b |\n| --- | --- |\n| new | d |")],
    [T, { type: "tableEdit", at: AT, op: { op: "setCell", row: 1, col: 0, runs: R("bold", { bold: true }) } }, out("| a | b |\n| --- | --- |\n| **bold** | d |")],
    [T, { type: "tableEdit", at: AT, op: { op: "setCell", row: 1, col: 0, runs: R("  two\nlines ") } }, out("| a | b |\n| --- | --- |\n| two lines | d |"), "ends trimmed, a line break becomes a space"],
    [T, { type: "tableEdit", at: AT, op: { op: "setCellSource", row: 0, col: 1, markdown: "![](note.assets/x.png)" } }, out("| a | ![](note.assets/x.png) |\n| --- | --- |\n| c | d |")],
    [T, { type: "tableEdit", at: AT, op: { op: "styleCell", row: 1, col: 1, from: 0, to: 0, change: B } }, out("| a | b |\n| --- | --- |\n| c | **d** |"), "nothing selected: the whole cell"],
    [T.replace("| c |", "| **c** |"), { type: "tableEdit", at: AT, op: { op: "styleCell", row: 1, col: 0, from: 0, to: 1, change: B } }, out("| a | b |\n|---|---|\n| **c** | d |"), "already on: nothing changes"],
    [T.replace("| c |", "| **c**x |"), { type: "tableEdit", at: AT, op: { op: "styleCell", row: 1, col: 0, from: 0, to: 2, change: { kind: "bold", on: false } } }, out("| a | b |\n| --- | --- |\n| cx | d |"), "off over a mixed selection"],
    [T, { type: "tableEdit", at: AT, op: { op: "addRow", after: 1 } }, out("| a | b |\n| --- | --- |\n| c | d |\n| | |")],
    [T, { type: "tableEdit", at: AT, op: { op: "addRow", after: 0 } }, out("| a | b |\n| --- | --- |\n| | |\n| c | d |")],
    [T, { type: "tableEdit", at: AT, op: { op: "removeRow", row: 1 } }, out("| a | b |\n| --- | --- |")],
    [T, { type: "tableEdit", at: AT, op: { op: "removeRow", row: 0 } }, { refused: /header row/ }],
    [T, { type: "tableEdit", at: AT, op: { op: "addColumn", after: 0 } }, out("| a | | b |\n| --- | --- | --- |\n| c | | d |")],
    [T, { type: "tableEdit", at: AT, op: { op: "removeColumn", col: 1 } }, out("| a |\n| --- |\n| c |")],
    ["| a |\n|---|\n| c |\n\nx¦", { type: "tableEdit", at: 0, op: { op: "removeColumn", col: 0 } }, { refused: /at least one column/ }],
    [T, { type: "tableEdit", at: AT, op: { op: "addRow", after: 1 }, pending: { row: 1, col: 1, runs: R("typed") } }, out("| a | b |\n| --- | --- |\n| c | typed |\n| | |"), "pending: the cell and the operation in one edit"],
    [T, { type: "tableEdit", at: AT, op: { op: "styleCell", row: 0, col: 0, from: 0, to: 0, change: B }, pending: { row: 0, col: 0, runs: R("") } }, { refused: /Type something/ }, "an empty cell refuses a style"],
    [T, { type: "tableEdit", at: 0, op: { op: "addRow", after: 1 } }, { refused: /no table/ }],
    ["- | a |\n  |---|\n  | b |\n\nx¦", { type: "tableEdit", at: 2, op: { op: "addRow", after: 1 } }, { refused: /as text/ }, "a table parseTable cannot read is edited only as text"],
  ]);
});

test("7.4.2 an edit outside its region is refused", () => {
  const text = "One\n\nTwo\n\nThree\n\nFour";
  const m = buildModel(text);
  const sel = { anchor: text.length, head: text.length };
  // The caret in "Four": its region is "Three" and "Four"; an edit to "One" is outside.
  assert.match(checkRegion(m, { type: "insertText", text: "x" }, sel, { from: 0, to: 1, insert: "X" }) ?? "", /outside/);
  assert.equal(checkRegion(m, { type: "insertText", text: "x" }, sel, { from: 12, to: 13, insert: "X" }), null);
  // setMeta: only the front matter, or position 0.
  assert.match(checkRegion(m, { type: "setMeta", key: "title", value: "x" }, sel, { from: 5, to: 5, insert: "x" }) ?? "", /outside/);
  assert.equal(checkRegion(m, { type: "setMeta", key: "title", value: "x" }, sel, { from: 0, to: 0, insert: "---\ntitle: x\n---\n" }), null);
});

test("describe and describeCell: on, off and mixed", () => {
  const d = (marked: string, typing?: Typing) => {
    const doc = parse(marked, typing);
    return describe(doc, buildModel(doc.text));
  };
  assert.equal(d("**b¦** x").bold, "on");
  assert.equal(d("«**b** x»").bold, "mixed");
  assert.equal(d("«one two»").bold, "off");
  assert.deepEqual(d("[r]{color=red} ¦").color, { mixed: false, value: "red" });
  assert.deepEqual(d("«[r]{color=red} b»").color, { mixed: true });
  assert.equal(d("```\nco¦de\n```").inCode, true);
  assert.equal(d("```\nco¦de\n```").can.bold, false);
  assert.deepEqual(d("¦").size, { mixed: false, value: 12 });
  assert.deepEqual(d("# h¦").size, { mixed: false, value: 24 });
  assert.equal(d("- a¦").list, "bullet");
  assert.equal(d("- ¦").list, "bullet");
  assert.equal(d("# h¦").block, "h1");
  assert.equal(d("[l](https://e.com)¦ x").link, "https://e.com");
  assert.equal(d("plain¦", { marks: [B], block: null }).bold, "on", "typing.marks shown");
  assert.equal(d("¦", { marks: [], block: "quote" }).block, "quote", "typing.block shown");
  assert.equal(describeCell("**a**b", 0, 0).bold, "mixed", "nothing selected: the whole cell");
  assert.equal(describeCell("**a**b", 0, 1).bold, "on");
  assert.equal(describeCell("**a**b", 0, 1).can.block, false);
});

test("the selection after a widget or settings edit is mapped through the edit (7.2 new)", () => {
  check([
    ["- [ ] mi¦lk", { type: "toggleTask", at: 2 }, "- [x] mi¦lk"],
    ["Hel¦lo", { type: "setMeta", key: "title", value: "T" }, "---\ntitle: T\n---\nHel¦lo"],
    [T.replace("After¦", "Af¦ter"), { type: "tableEdit", at: AT, op: { op: "addRow", after: 1 } }, "Intro\n\n| a | b |\n| --- | --- |\n| c | d |\n| | |\n\nAf¦ter"],
  ]);
});
