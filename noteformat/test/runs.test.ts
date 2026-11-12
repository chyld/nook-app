// SPEC 1.2 points, the theme sizes of EDITOR-PLAN 4, and styleRuns (EDITOR-PLAN 5.1).

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderNote, styleRuns, validSize, type VisibleChar } from "../src/index.ts";

const text = (cs: VisibleChar[]) => cs.map((c) => c.ch).join("");
const at = (src: string, ch: string, nth = 0) => {
  const r = styleRuns(src);
  return r.chars.filter((c) => c.ch === ch)[nth];
};

test("pt sizes: valid values and the CSS written", () => {
  for (const v of ["1pt", "12pt", "10.5pt", "400pt", "399.9pt"]) assert.equal(validSize(v), v, v);
  for (const v of ["0pt", "0.5pt", "012pt", "14.pt", "14.25pt", "400.1pt", "401pt", "12PT", "12 pt", "-3pt", "pt"]) assert.equal(validSize(v), null, v);
  assert.match(renderNote("[x]{size=14pt}").html, /font-size: 14pt/);
  assert.match(renderNote("Para\n{size=10.5pt}").html, /<p style="font-size: 10.5pt">/);
  assert.equal(renderNote("---\nsize: 14pt\n---\nx").meta.size, "14pt");
});

test("sizes in points: normal 12, headings 24 18 14 12 11 10, named sizes, px, pt", () => {
  assert.equal(at("normal", "n").style.size, 12);
  const heads = [1, 2, 3, 4, 5, 6].map((l) => Math.round(styleRuns(`${"#".repeat(l)} x`).chars[0].style.size * 10) / 10);
  assert.deepEqual(heads, [24, 18, 14, 12, 11, 10]);
  assert.equal(at("[x]{size=large}", "x").style.size, 15);
  assert.equal(at("[x]{size=22px}", "x").style.size, 16.5);
  assert.equal(at("[x]{size=10.5pt}", "x").style.size, 10.5);
  // A named size in a heading multiplies the heading's size.
  assert.equal(at("# a [x]{size=large}", "x").style.size, 30);
  // Block line, then a span inside it: 0.875 × 1.25 of the body.
  assert.equal(at("a [x]{size=large}\n{size=small}", "x").style.size, 12 * 0.875 * 1.25);
  assert.equal(at("a [x]{size=large}\n{size=small}", "a").style.size, 10.5);
  // Front matter size.
  assert.equal(at("---\nsize: 20px\n---\n[x]{size=large}", "x").style.size, 18.75);
  assert.equal(at("---\nsize: large\n---\n# x", "x").style.size, 30);
  assert.equal(at("---\nsize: 14pt\n---\nx", "x").style.size, 14);
});

test("colour, background, font and underline follow SPEC 5.5", () => {
  const s = (src: string, ch = "x") => at(src, ch).style;
  assert.equal(s("[x]{color=red}").color, "red");
  assert.equal(s("a x\n{color=blue}").color, "blue");
  assert.equal(s("a [x]{color=red}\n{color=blue}").color, "red");
  assert.equal(s("==x==").bg, "highlight");
  assert.equal(s("==[x]{bg=red}==").bg, "red");
  assert.equal(s("[==x==]{bg=red}").bg, "red");
  assert.equal(s("a ==x==\n{bg=blue}").bg, "highlight");
  assert.equal(s("++x++").underline, true);
  assert.equal(s("++[x]{underline=no}++").underline, true);
  assert.equal(s("a [x]{underline=no}\n{underline=yes}").underline, false);
  assert.equal(s("a x\n{underline=yes}").underline, true);
  assert.equal(s("---\nfont: Caveat\n---\nx").font, "Caveat");
  assert.equal(s("---\nfont: Caveat\n---\n`x`").font, null);
  assert.equal(s("---\nfont: Caveat\n---\n[`x`]{font=Inter}").font, "Inter");
  assert.equal(s("[x]{color=RED}").color, "red");
});

test("bold, italic, strike, code and links", () => {
  const st = at("***x***", "x").style;
  assert.ok(st.bold && st.italic);
  assert.ok(at("~~x~~", "x").style.strike);
  assert.ok(at("`x`", "x").style.code);
  assert.equal(at("[x](https://a.example)", "x").style.link, "https://a.example");
  assert.equal(at("see https://x.example now", "x").style.link, "https://x.example");
  assert.equal(at("<https://x.example>", "x").style.link, "https://x.example");
  assert.equal(at("[x][r]\n\n[r]: /dest", "x").style.link, "/dest");
});

test("visible characters, breaks, images, blocks", () => {
  const r = styleRuns("# Title\n\nOne\ntwo  \nthree\\\nfour\n\n- [ ] task\n\n> quote\n\n```\ncode\n```\n\n![alt](<p.png>)\n{width=50%}\n\n---\n\n| a | b |\n|---|---|\n| c | d |\n");
  assert.equal(text(r.chars), "TitleOne two\nthree\nfourtaskquotecode\n￼abcd");
  assert.deepEqual(
    r.blocks.map((b) => [b.kind, b.path]),
    [
      ["heading", ""],
      ["paragraph", ""],
      ["paragraph", "/list:bullet/item:0:task"],
      ["paragraph", "/quote"],
      ["code", ""],
      ["paragraph", ""],
      ["rule", ""],
      ["cell", "/table/r0/c0"],
      ["cell", "/table/r0/c1"],
      ["cell", "/table/r1/c0"],
      ["cell", "/table/r1/c1"],
    ],
  );
  const kinds = r.chars.filter((c) => c.kind !== "text").map((c) => c.kind);
  assert.deepEqual(kinds, ["soft", "hard", "hard", "image"]);
  const img = r.chars.find((c) => c.kind === "image")!;
  assert.deepEqual(img.image, { destination: "p.png", alt: "alt", width: "50%" });
  assert.equal(r.blocks[0].topLevel, true);
  assert.equal(r.blocks[2].topLevel, false);
  assert.equal(styleRuns("Title\n=====").blocks[0].topLevel, false);
});

test("source offsets of each character: escapes, entities, code spans, CRLF", () => {
  const src = "a\\*b &amp; `c d` é\r\nx";
  const r = styleRuns(src);
  const spans = r.chars.map((c) => [c.ch, src.slice(c.start, c.end)]);
  assert.deepEqual(spans, [
    ["a", "a"],
    ["*", "\\*"],
    ["b", "b"],
    [" ", " "],
    ["&", "&amp;"],
    [" ", " "],
    ["c", "c"],
    [" ", " "],
    ["d", "d"],
    [" ", " "],
    ["é", "é"],
    [" ", "\r\n"],
    ["x", "x"],
  ]);
  // A code span with surrounding spaces stripped.
  const r2 = styleRuns("`` `x` ``");
  assert.deepEqual(r2.chars.map((c) => [c.ch, "`` `x` ``".slice(c.start, c.end)]), [
    ["`", "`"],
    ["x", "x"],
    ["`", "`"],
  ]);
});

test("source offsets of code block characters: fenced and indented, CRLF", () => {
  for (const src of ["```\nab\ncd\n```", "```js\r\nab\r\ncd\r\n```", "    ab\n    cd"]) {
    const r = styleRuns(src);
    const got = r.chars.map((c) => [c.ch, src.slice(c.start, c.end)]);
    const want = src.includes("\r\n") ? [["a", "a"], ["b", "b"], ["\n", "\r\n"], ["c", "c"], ["d", "d"], ["\n", "\r\n"]] : [["a", "a"], ["b", "b"], ["\n", "\n"], ["c", "c"], ["d", "d"], ["\n", src.startsWith("    ") ? "" : "\n"]];
    assert.deepEqual(got.slice(0, 5), want.slice(0, 5), JSON.stringify(src));
  }
});
