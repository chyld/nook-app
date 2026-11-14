// Typing, deleting, Enter, line-start shortcuts, copy and paste in rich mode (EDITOR-PLAN 3.2,
// 3.4, 5). Positions are given by a `|` in the text (and `^` for the other end of a selection).

import { test } from "node:test";
import assert from "node:assert/strict";
import { copySelection, deleteAt, enter, lineBreak, lineShortcut, pasteMarkdown, pastePlain, typeText, type Edit } from "../src/style/typing.ts";
import type { Change } from "../src/style/apply.ts";

function at(s: string): { text: string; from: number; to: number } {
  const c = s.indexOf("|");
  let t = s.slice(0, c) + s.slice(c + 1);
  const o = t.indexOf("^");
  if (o < 0) return { text: t, from: c, to: c };
  t = t.slice(0, o) + t.slice(o + 1);
  return o < c ? { text: t, from: o, to: c - 1 } : { text: t, from: c, to: o };
}
const show = (r: Edit) => {
  assert.ok(r.ok, r.ok ? "" : r.reason);
  return r.text.slice(0, r.cursor) + "|" + r.text.slice(r.cursor);
};
const type = (s: string, ins: string, pending: Change[] = []) => {
  const { text, from, to } = at(s);
  return show(typeText(text, from, to, ins, pending));
};
const typeAll = (s: string, ins: string) => {
  let { text, from } = at(s);
  for (const ch of ins) {
    const r = typeText(text, from, from, ch);
    assert.ok(r.ok, r.ok ? "" : r.reason);
    text = r.text;
    from = r.cursor;
    const sc = lineShortcut(text, from);
    if (sc && sc.ok) {
      text = sc.text;
      from = sc.cursor;
    }
  }
  return text.slice(0, from) + "|" + text.slice(from);
};

test("typing takes the style of the character before it (at a block's start, the one after)", () => {
  // Must succeed (EDITOR-PLAN 9.1): typing at the end of bold text.
  assert.equal(type("a **bold**| c", "x"), "a **boldx|** c");
  assert.equal(type("a **bold|** c", "x"), "a **boldx|** c");
  assert.equal(type("**bold**| c", " "), "**bold** | c");
  assert.equal(type("a [red]{color=red}| b", "s"), "a [reds|]{color=red} b");
  assert.equal(type("|**Bold** start", "x"), "**|xBold** start".replace("|x", "x|"));
  assert.equal(type("# Title|", "s"), "# Titles|");
  assert.equal(type("plain| text", "!"), "plain!| text");
  assert.equal(type("a `code`| b", "x"), "a `codex|` b");
  // A link is not extended at its end.
  assert.equal(type("see [link](https://a.example)| now", "s"), "see [link](https://a.example)s| now");
});

test("typing is literal: markup characters are escaped when they would act as markup", () => {
  assert.equal(typeAll("a|", "*b*"), "a*b\\*|");
  assert.equal(typeAll("x|", " [y]{color=red}"), "x [y]{color=red\\}|");
  assert.equal(typeAll("x|", " **y**"), "x **y\\*\\*|");
  assert.equal(typeAll("x |", "1 < 2 & 3"), "x 1 < 2 & 3|");
  assert.equal(typeAll("a |", "&amp;"), "a &amp\\;|");
  // or-deepseek 6: `#` can be typed literally in the middle of a line.
  assert.equal(typeAll("Issue |", "#12"), "Issue #12|");
});

test("pending style: the next characters typed get it (grok 7, EDITOR-PLAN 3.4)", () => {
  assert.equal(type("H|ello", "x", [{ kind: "size", pt: 14 }]), "H[x|]{size=14pt}ello");
  assert.equal(type("H[x]{size=14pt}|ello", "y"), "H[xy|]{size=14pt}ello");
  assert.equal(type("one |two", "new", [{ kind: "bold", on: true }]), "one **new|**two");
  assert.equal(type("**one** |two", "n", [{ kind: "bold", on: false }]), "**one** n|two");
  assert.equal(type("a|", "b", [{ kind: "color", value: "red" }, { kind: "italic", on: true }]), "a[*b|*]{color=red}");
});

test("line-start shortcuts, each one step after the typed characters", () => {
  assert.equal(typeAll("|", "- item"), "- item|");
  assert.equal(typeAll("|", "1. first"), "1. first|");
  assert.equal(typeAll("|", "[] task"), "- [ ] task|");
  // The marks of a heading, a quote and a code block are not shortcuts (SPEC-PLAIN): they stay text.
  assert.equal(typeAll("|", "# Title"), "\\# Title|");
  assert.equal(typeAll("|", "> quoted"), "\\> quoted|");
  for (const [text, cursor] of [["\\# ", 3], ["\\### ", 5], ["\\> ", 3], ["``\\`", 4]] as const) assert.equal(lineShortcut(text, cursor), null, text);
  // In the middle of a line they are literal.
  assert.equal(typeAll("x|", " # y"), "x # y|");
  // At the start of a paragraph with text after it.
  const { text } = at("|Already here");
  let r = typeText(text, 0, 0, "-");
  assert.ok(r.ok);
  r = typeText(r.text, r.cursor, r.cursor, " ");
  assert.ok(r.ok);
  assert.equal(show(r), "\\- |Already here");
  assert.equal(show(lineShortcut(r.text, r.cursor)!), "- |Already here");
});

test("deleting removes visible characters only; markup goes with the last character (haiku 4c)", () => {
  const del = (s: string, dir: -1 | 1, word = false) => {
    const { text, from } = at(s);
    return show(deleteAt(text, from, dir, word));
  };
  assert.equal(del("a **|b**", -1), "a|**b**");
  assert.equal(del("a |**b**", -1), "a|**b**");
  assert.equal(del("a **b**| c", -1), "a | c");
  assert.equal(del("a **b|** c", -1), "a | c");
  assert.equal(del("a [x]{color=red}| c", -1), "a | c");
  assert.equal(del("a [xy|]{color=red} c", -1), "a [x|]{color=red} c");
  assert.equal(del("a| **b** c", 1), "a|**b** c");
  assert.equal(del("one two|", -1, true), "one |");
  assert.equal(del("a \\*b|", -1), "a \\*|");
  assert.equal(del("x &amp;| y", -1), "x | y");
  // A selection across styles.
  const { text, from, to } = at("a **b^c** [de|]{color=red} f");
  const r = typeText(text, from, to, "");
  assert.equal(show(r), "a **b|** f");
  const r2 = typeText("a **bc** [de]{color=red} f", 5, 11, "");
  assert.equal(show(r2), "a **b|**[e]{color=red} f");
});

test("Backspace at a block's start: heading, quote and list item become text; paragraphs join", () => {
  const bs = (s: string) => {
    const { text, from } = at(s);
    return show(deleteAt(text, from, -1));
  };
  assert.equal(bs("# |Title"), "|Title");
  assert.equal(bs("> |quoted"), "|quoted");
  assert.equal(bs("- |one"), "|one");
  assert.equal(bs("- a\n- |b\n- c"), "- a\n\n|b\n\n- c");
  assert.equal(bs("one\n\n|two"), "one|two");
  assert.equal(bs("**one**\n\n|*two*"), "**one***|two*");
  assert.equal(bs("one\n\n---\n\n|two"), "one\n\n|two");
  assert.equal(bs("one\n\n\n|"), "one\n\n|");
  // A paragraph with its own attribute line cannot join without changing its look.
  const r = deleteAt("one\n{color=red}\n\ntwo", "one\n{color=red}\n\n".length, -1);
  assert.equal(r.ok, false);
});

test("Enter: new paragraph, list item, split with markup reopened; after an attribute line (sonnet 5, argon 3)", () => {
  const en = (s: string) => {
    const { text, from, to } = at(s);
    return show(enter(text, from, to));
  };
  assert.equal(en("one|"), "one\n\n|");
  assert.equal(en("one two|\n\nthree"), "one two\n\n|\n\nthree");
  assert.equal(en("text|\n{color=gray}"), "text\n{color=gray}\n\n|");
  assert.equal(en("ab|cd"), "ab\n\n|cd");
  assert.equal(en("ab |cd"), "ab\n\n|cd");
  assert.equal(en("**ab|cd**"), "**ab**\n\n**|cd**");
  assert.equal(en("x [ab|cd]{color=red} y"), "x [ab]{color=red}\n\n[|cd]{color=red} y");
  assert.equal(en("ab|cd\n{color=gray}"), "ab\n{color=gray}\n\n|cd\n{color=gray}");
  assert.equal(en("# Tit|le"), "# Tit\n\n# |le");
  assert.equal(en("- one|\n- two"), "- one\n- |\n- two");
  assert.equal(en("- on|e"), "- on\n- |e");
  assert.equal(en("1. one|"), "1. one\n2. |");
  assert.equal(en("- [x] done|"), "- [x] done\n- [ ] |");
  assert.equal(en("> quo|ted"), "> quo\n>\n> |ted");
  // On an empty item, Enter ends the list.
  assert.equal(en("- one\n- |"), "- one\n|");
  // In a code block a new line is raw.
  assert.equal(en("```\nab|\n```"), "```\nab\n|\n```");
  // Typing on the new line makes a paragraph of its own.
  const e = enter("# Head\nnext", 6, 6);
  assert.ok(e.ok);
  assert.equal(show(typeText(e.text, e.cursor, e.cursor, "x")), "# Head\n\nx|\n\nnext");
});

test("Shift+Enter makes a line break in the paragraph", () => {
  const { text, from } = at("one **two| three**");
  assert.equal(show(lineBreak(text, from, from)), "one **two\\\n|three**".replace("\\\n|three", "\\\n|three"));
  const r = lineBreak("- ab", 3, 3);
  assert.equal(show(r), "- a\\\n  |b");
});

test("copy gives the visible text and the selection's Markdown; paste keeps it inside the app", () => {
  const { text, from, to } = at("Some ^**bold and [red]{color=red}|** words");
  const c = copySelection(text, from, to);
  assert.equal(c.plain, "bold and red");
  assert.equal(c.markdown, "**bold and [red]{color=red}**");
  const p = at("Paste here: |.");
  assert.equal(show(pasteMarkdown(p.text, p.from, p.to, c.markdown!, c.plain)), "Paste here: **bold and [red|]{color=red}**.");
  // Across paragraphs.
  const two = at("# He^ad\n\nbody te|xt");
  const c2 = copySelection(two.text, two.from, two.to);
  assert.equal(c2.plain, "ad\nbody te");
  assert.equal(c2.markdown, "# ad\n\nbody te");
});

test("paste from elsewhere is literal text, one paragraph per line", () => {
  const p = at("Start |end");
  assert.equal(show(pastePlain(p.text, p.from, p.to, "a *b*")), "Start a \\*b\\*|end");
  const q = at("Start|");
  assert.equal(show(pastePlain(q.text, q.from, q.to, " one\r\n\r\ntwo\n# three")), "Start one\n\ntwo\n\n\\# three|");
});
