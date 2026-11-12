// EDITOR-PLAN 5.4: block style, lists and inserted blocks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { blockStyleAt, insertBlock, listKindAt, setBlockStyle, toggleList } from "../src/style/blocks.ts";

const all = (t: string) => [0, t.length] as const;

test("block style: headings, normal text, quote, code block", () => {
  const ok = (r: ReturnType<typeof setBlockStyle>) => {
    assert.ok(r.ok, r.ok ? "" : r.reason);
    return r.text;
  };
  assert.equal(ok(setBlockStyle("Title here", 0, 3, "h1")), "# Title here");
  assert.equal(ok(setBlockStyle("# Title here", 3, 5, "h3")), "### Title here");
  assert.equal(ok(setBlockStyle("## Title ##", 3, 5, "paragraph")), "Title");
  assert.equal(ok(setBlockStyle("# Title\n{color=red}", 2, 4, "h2")), "## Title\n{color=red}");
  assert.equal(ok(setBlockStyle("Some **bold** text", 0, 4, "quote")), "> Some **bold** text");
  assert.equal(ok(setBlockStyle("> one\n> two", 2, 4, "paragraph")), "one\ntwo");
  assert.equal(ok(setBlockStyle("plain code-like text", 0, 5, "code")), "```\nplain code-like text\n```");
  assert.equal(ok(setBlockStyle("```\na*b\nc\n```", 4, 5, "paragraph")), "a\\*b  \nc");
  // Refusals, with the reason.
  assert.deepEqual(setBlockStyle("two\nlines", 0, 2, "h1"), { ok: false, reason: "a heading is one line; this paragraph has several" });
  assert.deepEqual(setBlockStyle("**bold**", 0, 2, "code"), { ok: false, reason: "a code block cannot keep the text's formatting" });
  // Several blocks at once; text outside them unchanged.
  assert.equal(ok(setBlockStyle("one\n\ntwo\n\nthree", 0, 8, "h2")), "## one\n\n## two\n\nthree");
});

test("block style at the selection, for the toolbar", () => {
  assert.equal(blockStyleAt("# a\n\nb", 1, 2), "h1");
  assert.equal(blockStyleAt("# a\n\nb", 0, 6), null);
  assert.equal(blockStyleAt("> q", 2, 3), "quote");
  assert.equal(blockStyleAt("```\nx\n```", 4, 4), "code");
});

test("lists: on, another kind, off", () => {
  let r = toggleList("one\n\ntwo", 0, 8, "bullet");
  assert.ok(r.ok);
  assert.equal(r.text, "- one\n- two");
  assert.equal(listKindAt(r.text, 2, 3), "bullet");
  r = toggleList(r.text, 0, r.text.length, "ordered");
  assert.ok(r.ok);
  assert.equal(r.text, "1. one\n2. two");
  r = toggleList(r.text, 0, r.text.length, "task");
  assert.ok(r.ok);
  assert.equal(r.text, "- [ ] one\n- [ ] two");
  r = toggleList(r.text, 0, r.text.length, "task");
  assert.ok(r.ok);
  assert.equal(r.text, "one\n\ntwo");
  const multi = toggleList("line one\nline two", 0, 3, "bullet");
  assert.ok(multi.ok);
  assert.equal(multi.text, "- line one\n  line two");
  void all;
});

test("inserted blocks: a table and a horizontal line after the block", () => {
  // A line leaves the cursor on an empty line under it.
  assert.deepEqual(insertBlock("para", 2, "rule"), { text: "para\n\n---\n\n", from: 11, to: 11 });
  assert.deepEqual(insertBlock("para\n\nnext", 2, "rule"), { text: "para\n\n---\n\n\n\nnext", from: 11, to: 11 });
  assert.equal(insertBlock("para\n\nnext", 2, "table").text, "para\n\n| Column 1 | Column 2 |\n|---|---|\n| | |\n\nnext");
});
