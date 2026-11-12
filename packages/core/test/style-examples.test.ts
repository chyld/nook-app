// EDITOR-PLAN 8, applyStyle by example: every case of plan section 5 and every case the
// reviewers gave (editor-reviews-1/), with the expected text, each also judged by the
// independent checker.

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyStyle, stepSize, ptValue, type Change } from "../src/style/apply.ts";
import { selectVisible } from "../src/style/visible.ts";
import { styleRuns } from "../../../noteformat/src/index.ts";
import { judge, type OChange } from "./style-oracle.ts";

function oc(c: Change): OChange | null {
  switch (c.kind) {
    case "color":
    case "bg":
      return { prop: c.kind, value: c.value };
    case "font":
      return { prop: "font", value: c.value };
    case "size":
      return { prop: "size", value: c.pt };
    case "size-step":
      return { prop: "step", dir: c.dir };
    case "underline":
      return { prop: "u", value: c.on };
    case "bold":
      return { prop: "b", value: c.on };
    case "italic":
      return { prop: "i", value: c.on };
    case "strike":
      return { prop: "s", value: c.on };
    case "code":
      return { prop: "code", value: c.on };
    case "link":
      return { prop: "link", value: c.url };
    default:
      return null;
  }
}

/** [source, selected visible text, change, expected text, where the case comes from] */
const CASES: [string, string, Change, string, string][] = [
  // EDITOR-PLAN 5.3
  ["a**b**c", "b", { kind: "color", value: "red" }, "a[**b**]{color=red}c", "plan 5.3: whole content of emphasis, wrapped from outside"],
  ["[**ab**]{color=red}", "b", { kind: "size", pt: 14 }, "[**a**]{color=red}[**b**]{color=red size=14pt}", "plan 5.3: part of a span with emphasis"],
  ["++abcd++", "bc", { kind: "underline", on: false }, "[a]{underline=yes}bc[d]{underline=yes}", "plan 5.3: part of a ++ mark"],
  ["Text [piece] here", "[piece]", { kind: "size", pt: 14 }, "Text [[piece]]{size=14pt} here", "plan 5.3: balanced brackets need no escape"],
  ["Text [piece here", "[piece", { kind: "size", pt: 14 }, "Text [\\[piece]{size=14pt} here", "plan 5.3: an unmatched [ escaped"],
  ["Text [piece] here", "piece", { kind: "size", pt: 14 }, "Text [[piece]{size=14pt}] here", "plan 5.3: a piece inside literal brackets"],
  // sonnet
  ["see https://example.com/page now", "example", { kind: "size", pt: 14 }, "see [https://[example]{size=14pt}.com/page](https://example.com/page) now", "sonnet 1: part of a bare URL"],
  ["see <https://example.com/page> now", "example", { kind: "size", pt: 14 }, "see [https://[example]{size=14pt}.com/page](https://example.com/page) now", "sonnet 1: part of an autolink"],
  ["[a]{size=large} b", "a b", { kind: "size", pt: 14 }, "a b\n{size=14pt}", "sonnet 2: block line removes the overriding span size"],
  ["Small\n{size=small}", "Small", { kind: "size", pt: 12 }, "Small", "sonnet 2: normal size removes the block's size"],
  ["a**b**c d", "b", { kind: "color", value: "red" }, "a[**b**]{color=red}c d", "sonnet 3: a**b**c"],
  ["red `x` here and more", "red x here", { kind: "size", pt: 14 }, "[red `x` here]{size=14pt} and more", "sonnet 4: inline code wrapped"],
  ["- [ ] buy milk", "buy milk", { kind: "size", pt: 14 }, "- [ ] [buy milk]{size=14pt}", "sonnet 4: task marker not in the selection"],
  ["para\n- item", "para", { kind: "color", value: "red" }, "para\n{color=red}\n\n- item", "sonnet 4: block line needs a blank line after"],
  // sol
  ["[a]{color=red}[b]{color=red}\n\nword", "or", { kind: "size", pt: 14 }, "[a]{color=red}[b]{color=red}\n\nw[or]{size=14pt}d", "sol 1: no merging of unrelated spans"],
  ["[x]{size=large} y", "x", { kind: "size", pt: 14 }, "[x]{size=14pt} y", "sol 3: an existing size is replaced"],
  ["Title\n=====", "Title", { kind: "color", value: "red" }, "[Title]{color=red}\n=====", "sol 3: a setext heading takes a span"],
  // haiku
  ["[x]{size=large size=small} y", "x", { kind: "size", pt: 18 }, "[x]{size=large size=18pt} y", "haiku 1a: the last occurrence is edited"],
  ["red `code` here", "red code here", { kind: "color", value: "blue" }, "red `code` here\n{color=blue}", "haiku 1b: a sentence with code"],
  ["# Title\nBody", "Title", { kind: "color", value: "red" }, "# Title\n{color=red}\n\nBody", "haiku 2a: blank line after the heading's line"],
  ["Some text\n{color=gray}", "Some text", { kind: "color", value: "red" }, "Some text\n{color=red}", "haiku 2b: the existing line is edited"],
  ["- item one\n- item two", "item one", { kind: "color", value: "red" }, "- [item one]{color=red}\n- item two", "haiku 2c: a list item takes a span"],
  ["> quoted text", "quoted text", { kind: "color", value: "red" }, "> [quoted text]{color=red}", "haiku 2c: a quote takes a span"],
  ["Note 3] done", "3]", { kind: "size", pt: 14 }, "Note [3\\]]{size=14pt} done", "haiku 3a: an unmatched ] escaped"],
  ["a**bold**b", "bold", { kind: "size", pt: 14 }, "a[**bold**]{size=14pt}b", "haiku 3b: emphasis wrapped from outside"],
  // terra
  ["Visit https://example.com/path today", "example", { kind: "size", pt: 14 }, "Visit [https://[example]{size=14pt}.com/path](https://example.com/path) today", "terra 1: a bare URL"],
  ["[hello]{size=18px}", "hello", { kind: "size", pt: 14 }, "hello\n{size=14pt}", "terra 2: the span's size gives way to the block's"],
  ["- hello", "hello", { kind: "size", pt: 14 }, "- [hello]{size=14pt}", "terra 2: a list item"],
  ["x ++hello++ y", "ell", { kind: "underline", on: false }, "x [h]{underline=yes}ell[o]{underline=yes} y", "terra 3: part of a ++ mark"],
  ["one `two` three", "one two three", { kind: "size", pt: 14 }, "one `two` three\n{size=14pt}", "terra 3: code in a sentence"],
  // grok
  ["# Hello\nWorld starts here.", "Hello", { kind: "size", pt: 14 }, "# Hello\n{size=14pt}\n\nWorld starts here.", "grok 1: heading line with a blank line"],
  ["hello [world and more", "lo [wor", { kind: "size", pt: 14 }, "hel[lo \\[wor]{size=14pt}ld and more", "grok 2: an unmatched [ escaped"],
  ["++hello world++", "world", { kind: "underline", on: false }, "[hello ]{underline=yes}world", "grok 2: underline off in a mark"],
  ["Hello there", "Hello", { kind: "size", pt: 12 }, "Hello there", "grok 3: the normal size changes nothing"],
  // argon
  ["**hello world**", "hello", { kind: "bold", on: false }, "hello **world**", "argon 1: bold off, space moved out"],
  ["==hello world==", "hello", { kind: "bg", value: null }, "hello[ world]{bg=highlight}", "argon 1: highlight off in a mark"],
  ["See https://example.com/docs/guide today", "https://example.com", { kind: "color", value: "red" }, "See [[https://example.com]{color=red}/docs/guide](https://example.com/docs/guide) today", "argon 2: start of a bare URL"],
  ["Hello [world]{color=blue}", "Hello world", { kind: "color", value: "red" }, "Hello world\n{color=red}", "argon 3a: inner span key removed"],
  ["Hello world\n{size=18pt}", "Hello", { kind: "size", pt: 12 }, "[Hello]{size=12pt} world\n{size=18pt}", "argon 3b: normal size under a sized line"],
  ["[see [the guide](https://example.com) now]{color=red}", "the guide", { kind: "size", pt: 14 }, "[see ]{color=red}[[the guide](https://example.com)]{color=red size=14pt}[ now]{color=red}", "argon 4: a link in a span"],
  ["[a] b\n\n[a]: https://example.com", "a", { kind: "color", value: "red" }, "[[a]]{color=red} b\n\n[a]: https://example.com", "argon 4: a shortcut reference link"],
  // or-deepseek
  ["The [small print]{size=small} is here.", "The small print is here.", { kind: "size", pt: 24 }, "The small print is here.\n{size=24pt}", "or-deepseek 1"],
  ["first line  \nsecond line", "first line", { kind: "size", pt: 14 }, "[first line]{size=14pt}  \nsecond line", "or-deepseek 2: hard break kept"],
  ["https://example.com/page", "https://example.com", { kind: "size", pt: 14 }, "[[https://example.com]{size=14pt}/page](https://example.com/page)", "or-deepseek 2: a bare URL"],
  ["[*Saudade*]{color=red} x", "aud", { kind: "size", pt: 14 }, "[*S*]{color=red}[*aud*]{color=red size=14pt}[*ade*]{color=red} x", "or-deepseek 3: emphasis reopened"],
  ["==pack sunscreen==", "pack", { kind: "underline", on: true }, "==[pack]{underline=yes} sunscreen==", "or-deepseek 3: underline inside a highlight"],
  ["Grey and small.\n{color=gray size=small}", "Grey and small.", { kind: "size", pt: 18 }, "Grey and small.\n{color=gray size=18pt}", "or-deepseek 4: the existing line edited"],
  ["- Pack charger", "Pack charger", { kind: "size", pt: 14 }, "- [Pack charger]{size=14pt}", "or-deepseek 4: a list item"],
  ["**word** x", "wor", { kind: "bold", on: false }, "wor**d** x", "or-deepseek 7: bold off for part"],
  // dr-deepseek
  ["Visit https://example.com/path now.", "example", { kind: "color", value: "red" }, "Visit [https://[example]{color=red}.com/path](https://example.com/path) now.", "dr-deepseek 1"],
  ["Use {name} here.", "{name}", { kind: "color", value: "red" }, "Use [{name}]{color=red} here.", "dr-deepseek 2: braces"],
  ["x C++ y", "C++", { kind: "underline", on: true }, "x [C++]{underline=yes} y", "dr-deepseek 2: a delimiter in the piece"],
  ["Grey claim here.\n{color=gray}", "claim", { kind: "color", value: null }, "[Grey ]{color=gray}claim[ here.]{color=gray}", "dr-deepseek 3: None for part of a coloured block"],
  ["# Trip\nPack light.", "Trip", { kind: "color", value: "red" }, "# Trip\n{color=red}\n\nPack light.", "dr-deepseek 3: heading then a paragraph"],
  // Other commands
  ["abc", "b", { kind: "bold", on: true }, "a**b**c", "bold on, inside a word"],
  ["a **b** c d", "a b c", { kind: "bold", on: true }, "**a b c** d", "bold on, merging"],
  ["a b c", "b", { kind: "italic", on: true }, "a *b* c", "italic on"],
  ["a b c", "b", { kind: "strike", on: true }, "a ~~b~~ c", "strikethrough on"],
  ["a b c", "b", { kind: "code", on: true }, "a `b` c", "inline code on"],
  ["a `b` c", "b", { kind: "code", on: false }, "a b c", "inline code off"],
  ["plain words here", "words", { kind: "link", url: "https://x.example" }, "plain [words](https://x.example) here", "link added"],
  ["a [link](https://a.example) b", "link", { kind: "link", url: null }, "a link b", "link removed"],
  ["a [link](https://a.example) b", "link", { kind: "link", url: "https://b.example" }, "a [link](https://b.example) b", "link changed"],
  ["a [b]{size=14pt} c d", "a b c", { kind: "size-step", dir: 1 }, "[a ]{size=13pt}[b]{size=15pt}[ c]{size=13pt} d", "size up, piece by piece (one point, SPEC2 1.3)"],
  ["x [y]{font=serif} z", "y", { kind: "font", value: null }, "x y z", "font default"],
  ["x y z", "y", { kind: "font", value: "IBM Plex Serif" }, 'x [y]{font="IBM Plex Serif"} z', "a font name with spaces is quoted"],
];

test("applyStyle: the plan's and the reviewers' cases give the expected text", () => {
  for (const [text, sel, change, expected, from] of CASES) {
    const { from: f, to } = selectVisible(text, sel);
    const r = applyStyle(text, f, to, change);
    assert.ok(r.ok, `${from}: refused: ${r.ok ? "" : r.reason}`);
    assert.equal(r.text, expected, from);
    const o = oc(change);
    if (o && r.text !== text) {
      const shown = styleRuns(text).chars.map((c) => c.ch).join("");
      const a = shown.indexOf(sel);
      let range: [number, number] = [a, a + sel.length];
      // Link removal and change act on the whole link.
      if (change.kind === "link" && change.url !== "https://x.example") range = [r.applied[0], r.applied[r.applied.length - 1] + 1];
      assert.equal(judge(text, r.text, range, o, null), null, `${from}: ${r.text}`);
    }
  }
});

test("applyStyle: the selection after the change covers the same visible text", () => {
  const text = "a**b**c";
  const { from, to } = selectVisible(text, "b");
  const r = applyStyle(text, from, to, { kind: "color", value: "red" });
  assert.ok(r.ok);
  assert.equal(r.text.slice(r.from, r.to), "b");
});

test("applyStyle: refusals leave the text alone and say why; other blocks are still changed", () => {
  const text = "```\ncode\n```\n\nplain";
  const r = applyStyle(text, 0, text.length, { kind: "color", value: "red" });
  assert.ok(r.ok);
  assert.equal(r.text, "```\ncode\n```\n\nplain\n{color=red}");
  assert.deepEqual(r.skipped, { count: 1, reasons: ["inside a code block"] });
  const only = applyStyle("```\ncode\n```", 0, 12, { kind: "color", value: "red" });
  assert.deepEqual(only, { ok: false, reason: "inside a code block" });
  // Part of a code span is left out.
  const t2 = "ab `cd` ef";
  const { from, to } = selectVisible(t2, "b c");
  const r2 = applyStyle(t2, from, to, { kind: "color", value: "red" });
  assert.ok(r2.ok);
  assert.equal(r2.text, "a[b ]{color=red}`cd` ef");
  assert.deepEqual(r2.skipped.reasons, ["part of a code span"]);
  assert.deepEqual(applyStyle("x", 0, 0, { kind: "bold", on: true }), { ok: false, reason: "nothing is selected" });
});

test("sizes: stepping by one point and the written value (SPEC2 1.3)", () => {
  assert.equal(stepSize(12, 1), 13);
  assert.equal(stepSize(15, 1), 16);
  assert.equal(stepSize(16.5, -1), 15.5);
  assert.equal(stepSize(96, 1), 97);
  assert.equal(stepSize(8, -1), 7);
  assert.equal(stepSize(400, 1), 400);
  assert.equal(stepSize(1, -1), 1);
  assert.equal(stepSize(1.5, -1), 1);
  assert.equal(ptValue(14), "14pt");
  assert.equal(ptValue(10.5), "10.5pt");
  assert.equal(ptValue(10.25), "10.3pt");
});

test("clear formatting removes colour, highlight, font, size, underline, bold, italic and strikethrough", () => {
  const text = "**bold** [red]{color=red size=18pt} ++u++ *i* ~~s~~ ==h==";
  const r = applyStyle(text, 0, text.length, { kind: "clear" });
  assert.ok(r.ok, r.ok ? "" : r.reason);
  assert.equal(r.text, "bold red u i s h");
});
