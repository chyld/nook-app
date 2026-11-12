// SPEC 2 The file: byte order mark, line endings; and source ranges of the syntax tree.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNote } from "../src/index.ts";
import type { Block, Inline } from "../src/index.ts";
import { html, p } from "./helpers.ts";

test("2 a byte order mark at the start is ignored when the note is parsed", () => {
  const note = parseNote("﻿---\ntitle: T\n---\n# Hi");
  assert.equal(note.bom, true);
  assert.deepEqual(note.frontMatter?.fields, { title: "T" });
  assert.equal(html("﻿# Hi"), "<h1>Hi</h1>\n");
  // Ranges still count the byte order mark, so they index the source as given.
  const h = parseNote("﻿# Hi").children[0];
  assert.ok(h.type === "heading");
  assert.deepEqual(h.children[0].range, { start: 3, end: 5 });
});

test("2 line endings are LF or CRLF; a line ending is never part of a line's content", () => {
  const crlf = "---\r\ntitle: T\r\n---\r\n# Hi\r\n\r\nLine one\r\nLine two  \r\nthree\r\n";
  const lf = crlf.replace(/\r\n/g, "\n");
  assert.equal(html(crlf), html(lf));
  assert.equal(html(lf), "<h1>Hi</h1>\n" + p("Line one\nLine two<br>\nthree"));
  assert.deepEqual(parseNote(crlf).frontMatter?.fields, { title: "T" });
});

test("2 CRLF source ranges point into the original text", () => {
  const src = "a\r\n**b**\r\n";
  const para = parseNote(src).children[0];
  assert.ok(para.type === "paragraph");
  const [text, brk, strong] = para.children;
  assert.deepEqual(text.range, { start: 0, end: 1 });
  assert.equal(brk.type, "softBreak");
  assert.deepEqual(brk.range, { start: 1, end: 3 });
  assert.deepEqual(strong.range, { start: 3, end: 8 });
  assert.equal(src.slice(strong.range.start, strong.range.end), "**b**");
});

test("2 NUL is replaced by U+FFFD, as CommonMark requires", () => {
  assert.equal(html("a\0b"), p("a�b"));
});

/** Every node's range slices out text that belongs to it. */
function walkInline(nodes: readonly Inline[], src: string, visit: (n: Inline, text: string) => void) {
  for (const n of nodes) {
    visit(n, src.slice(n.range.start, n.range.end));
    if ("children" in n) walkInline(n.children, src, visit);
  }
}

test("source ranges: every inline node has a range that slices out its own source", () => {
  const src = "> A *b* [c](/u) ![d](e.png) `f` [g]{color=red} ++h++ ==i== ~~j~~ www.k.com\n> l";
  const quote = parseNote(src).children[0];
  assert.ok(quote.type === "blockQuote");
  const para = quote.children[0];
  assert.ok(para.type === "paragraph");
  // Nested nodes: each child's range lies inside its parent's and slices out its own text.
  const nested: [string, string][] = [];
  walkInline(para.children, src, (n, text) => {
    if ("children" in n) for (const c of n.children) nested.push([text, src.slice(c.range.start, c.range.end)]);
  });
  assert.deepEqual(nested, [
    ["*b*", "b"],
    ["[c](/u)", "c"],
    ["![d](e.png)", "d"],
    ["[g]{color=red}", "g"],
    ["++h++", "h"],
    ["==i==", "i"],
    ["~~j~~", "j"],
    ["www.k.com", "www.k.com"],
  ]);
  // The soft break between the quote's lines covers the line ending only.
  const brk = para.children.find((n) => n.type === "softBreak");
  assert.ok(brk);
  assert.equal(src.slice(brk.range.start, brk.range.end), "\n");
  const text = (n: Inline) => src.slice(n.range.start, n.range.end);
  assert.deepEqual(para.children.map(text), [
    "A ",
    "*b*",
    " ",
    "[c](/u)",
    " ",
    "![d](e.png)",
    " ",
    "`f`",
    " ",
    "[g]{color=red}",
    " ",
    "++h++",
    " ",
    "==i==",
    " ",
    "~~j~~",
    " ",
    "www.k.com",
    "\n",
    "l",
  ]);
});

test("source ranges: blocks cover their source lines", () => {
  const src = "# Title\n\n- one\n- two\n\n```js\ncode\n```\n\n| a |\n|---|\n| b |\n";
  const note = parseNote(src);
  const text = (b: Block) => src.slice(b.range.start, b.range.end);
  assert.deepEqual(note.children.map(text), ["# Title", "- one\n- two", "```js\ncode\n```", "| a |\n|---|\n| b |"]);
  const list = note.children[1];
  assert.ok(list.type === "list");
  assert.deepEqual(list.children.map((i) => src.slice(i.range.start, i.range.end)), ["- one", "- two"]);
  const table = note.children[3];
  assert.ok(table.type === "table");
  assert.equal(src.slice(table.body[0].cells[0].range.start, table.body[0].cells[0].range.end), "b");
});

test("source ranges: link reference definitions are listed with their ranges", () => {
  const src = "[a]\n\n[a]: /one 'T'\n[a]: /two\n";
  const note = parseNote(src);
  assert.deepEqual(
    note.definitions.map((d) => [d.label, d.destination, d.title, src.slice(d.range.start, d.range.end)]),
    [
      ["A", "/one", "T", "[a]: /one 'T'"],
      ["A", "/two", null, "[a]: /two"],
    ],
  );
  assert.equal(html(src), p('<a href="/one" title="T">a</a>'));
});
