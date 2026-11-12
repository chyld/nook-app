// SPEC 1.1 additions: the `id` front matter key (section 3), and the source range of every
// image destination, including the destination of a link reference definition an image uses
// (needed by the app's photo path routine, DESIGN 5.6 and 17 item 5).

import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidId, parseNote, renderNote, type Block, type Image, type Inline } from "../src/index.ts";

function images(source: string): Image[] {
  const out: Image[] = [];
  const walkInline = (nodes: readonly Inline[]) => {
    for (const n of nodes) {
      if (n.type === "image") out.push(n);
      if ("children" in n) walkInline(n.children);
    }
  };
  const walk = (blocks: readonly Block[]) => {
    for (const b of blocks) {
      if (b.type === "paragraph" || b.type === "heading") walkInline(b.children);
      else if (b.type === "blockQuote") walk(b.children);
      else if (b.type === "list") for (const item of b.children) walk(item.children);
      else if (b.type === "table") for (const row of [b.head, ...b.body]) for (const c of row.cells) walkInline(c.children);
    }
  };
  walk(parseNote(source).children);
  return out;
}

/** The destination text of each image, as written in the source. */
function dests(source: string): string[] {
  return images(source).map((im) => source.slice(im.destinationRange.start, im.destinationRange.end));
}

const ID = "abcdefgh2345";

test("id: a valid id is returned in the fields and in meta", () => {
  const src = `---\nid: ${ID}\ntitle: T\n---\nBody\n`;
  assert.equal(parseNote(src).frontMatter?.fields.id, ID);
  assert.equal(renderNote(src).meta.id, ID);
});

test("id: quoted ids are scalars like any other", () => {
  assert.equal(parseNote(`---\nid: "${ID}"\n---\n`).frontMatter?.fields.id, ID);
  assert.equal(parseNote(`---\nid: '${ID}'\n---\n`).frontMatter?.fields.id, ID);
});

test("id: invalid values are ignored and the key is kept in the mapping", () => {
  for (const v of ["bad", "abcdefgh234", "abcdefgh23456", "ABCDEFGH2345", "abcdefgh2341", "abcdefgh234 ", "[a]", ""]) {
    const src = `---\nid: ${v === "" ? "" : JSON.stringify(v)}\ntitle: x\n---\n`;
    const fm = parseNote(src).frontMatter;
    assert.ok(fm, v);
    assert.equal(fm.fields.id, undefined, v);
    assert.ok(fm.mapping.entries.some((e) => e.key === "id"), v);
    assert.equal(renderNote(src).meta.id, undefined, v);
  }
  // A sequence is not a scalar.
  assert.equal(parseNote(`---\nid: [${ID}]\n---\n`).frontMatter?.fields.id, undefined);
});

test("id: the last occurrence is used", () => {
  const src = `---\nid: ${ID}\nid: zzzzzzzzzzzz\n---\n`;
  assert.equal(parseNote(src).frontMatter?.fields.id, "zzzzzzzzzzzz");
  // The last occurrence is invalid: the key has no valid value.
  assert.equal(parseNote(`---\nid: ${ID}\nid: bad\n---\n`).frontMatter?.fields.id, undefined);
});

test("id: with a byte order mark and CRLF", () => {
  assert.equal(parseNote(`﻿---\r\nid: ${ID}\r\n---\r\nx\r\n`).frontMatter?.fields.id, ID);
});

test("id: no front matter, no id", () => {
  assert.equal(renderNote(`id: ${ID}\n`).meta.id, undefined);
});

test("isValidId", () => {
  assert.equal(isValidId(ID), true);
  assert.equal(isValidId("abcdefgh234"), false);
  assert.equal(isValidId("abcdefgh2340"), false);
  assert.equal(isValidId("abcdefgh234\n"), false);
});

test("image range: inline destinations as written", () => {
  assert.deepEqual(dests("![a](x.jpg)"), ["x.jpg"]);
  assert.deepEqual(dests("![a](<My note.assets/x.jpg>)"), ["<My note.assets/x.jpg>"]);
  assert.deepEqual(dests("![a](My%20note.assets/x.jpg \"title\")"), ["My%20note.assets/x.jpg"]);
  assert.deepEqual(dests("![a](  x.jpg  'title' )"), ["x.jpg"]);
  assert.deepEqual(dests("![a]()"), [""]);
  assert.deepEqual(dests("![a](<>)"), ["<>"]);
  assert.deepEqual(dests("![a](a\\)b.jpg)"), ["a\\)b.jpg"]);
  assert.deepEqual(dests("![a](f(1).jpg)"), ["f(1).jpg"]);
  assert.deepEqual(dests("x ![a](1.jpg) y ![b](<2 x.png>) z"), ["1.jpg", "<2 x.png>"]);
});

test("image range: destination on the next line of an inline image", () => {
  assert.deepEqual(dests("![a](\nx.jpg\n)"), ["x.jpg"]);
  assert.deepEqual(dests("![a](\r\nx.jpg\r\n)"), ["x.jpg"]);
});

test("image range: offsets count the byte order mark, front matter and CRLF", () => {
  const src = `﻿---\r\nid: ${ID}\r\n---\r\nLine\r\n![a](<N.assets/x.jpg>)\r\n`;
  const [im] = images(src);
  assert.equal(src.slice(im.destinationRange.start, im.destinationRange.end), "<N.assets/x.jpg>");
});

test("image range: inside containers, tables, links and spans", () => {
  assert.deepEqual(dests("> quote ![a](q.jpg)\n> ![b](<r s.jpg>)"), ["q.jpg", "<r s.jpg>"]);
  assert.deepEqual(dests("- item\n  ![a](l.jpg)\n- ![b](m.jpg)"), ["l.jpg", "m.jpg"]);
  assert.deepEqual(dests("| a | b |\n|---|---|\n| ![x](t.jpg) | ![y](<u v.jpg>) |"), ["t.jpg", "<u v.jpg>"]);
  assert.deepEqual(dests("[![a](in.jpg)](https://example.com)"), ["in.jpg"]);
  assert.deepEqual(dests("[text ![a](sp.jpg)]{color=red}"), ["sp.jpg"]);
  assert.deepEqual(dests("![outer ![inner](i.jpg)](o.jpg)"), ["o.jpg", "i.jpg"]);
});

test("image range: links have no image ranges and are not collected", () => {
  assert.deepEqual(dests("[a](x.jpg) ![b](y.jpg)"), ["y.jpg"]);
});

test("image range: reference images point at the definition's destination", () => {
  const src = "![a][ref] ![b][] ![ref]\n\n[ref]: <My note.assets/x.jpg> \"t\"\n[b]: b.jpg\n";
  const ims = images(src);
  assert.equal(ims.length, 3);
  assert.deepEqual(dests(src), ["<My note.assets/x.jpg>", "b.jpg", "<My note.assets/x.jpg>"]);
  assert.equal(ims[0].label, "REF"); // labels are normalised as CommonMark matches them
  assert.equal(ims[1].label, "B");
  assert.equal(ims[2].label, "REF");
  assert.deepEqual(ims[0].destinationRange, ims[2].destinationRange);
  // An inline image has no label.
  assert.equal(images("![a](x.jpg)")[0].label, undefined);
});

test("image range: the first definition of a label is the one used", () => {
  const src = "![a][r]\n\n[r]: first.jpg\n[R]: second.jpg\n";
  assert.deepEqual(dests(src), ["first.jpg"]);
  const defs = parseNote(src).definitions;
  assert.deepEqual(
    defs.map((d) => src.slice(d.destinationRange.start, d.destinationRange.end)),
    ["first.jpg", "second.jpg"],
  );
});

test("image range: definitions on several lines, indented, in containers, with CRLF", () => {
  assert.deepEqual(dests("![a][r]\n\n[r]:\n  dest.jpg\n  \"title\"\n"), ["dest.jpg"]);
  assert.deepEqual(dests("![a][r]\n\n   [r]: <in dent.jpg>\n"), ["<in dent.jpg>"]);
  assert.deepEqual(dests("![a][r]\n\n> [r]: quoted.jpg\n"), ["quoted.jpg"]);
  assert.deepEqual(dests("![a][r]\n\n- [r]: listed.jpg\n"), ["listed.jpg"]);
  assert.deepEqual(dests("![a][r]\r\n\r\n[r]:\r\n<c r.jpg>\r\n"), ["<c r.jpg>"]);
  assert.deepEqual(dests("![a][r]\n\n[\nr\n]: multi.jpg\n"), ["multi.jpg"]);
});

test("image range: the definition destination equals the parsed destination", () => {
  const src = "![a][r]\n\n[r]: a\\_b%20c.jpg\n";
  const [im] = images(src);
  assert.equal(im.destination, "a_b%20c.jpg");
  assert.equal(src.slice(im.destinationRange.start, im.destinationRange.end), "a\\_b%20c.jpg");
});
