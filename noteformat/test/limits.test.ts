// No input may throw or hang: the nesting limits of src/inline/items.ts (MAX_NESTING = 32,
// MAX_TREE_DEPTH = 128; see README "Nesting limit").

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNote, renderNote } from "../src/index.ts";
import type { Inline } from "../src/index.ts";

const N = 15000;

/** The depth of the inline tree under a block. */
function depth(nodes: readonly Inline[]): number {
  let d = 0;
  for (const n of nodes) if ("children" in n) d = Math.max(d, 1 + depth(n.children));
  return d;
}

function firstParagraph(src: string): Inline[] {
  const b = parseNote(src).children[0];
  assert.ok(b && b.type === "paragraph");
  return b.children;
}

function renders(src: string): string {
  const out = renderNote(src).html;
  assert.equal(typeof out, "string");
  return out;
}

test("limits: 15000 nested images return, nested at most 32 deep", () => {
  const src = "![".repeat(N) + "x" + "](u)".repeat(N);
  assert.ok(renders(src).length > 0);
  assert.equal(depth(firstParagraph(src)), 32);
});

test("limits: 15000 nested link brackets return", () => {
  assert.match(renders("[".repeat(N) + "x" + "](u)".repeat(N)), /<a href="u">x<\/a>/);
});

test("limits: 15000 nested spans inside link text return, nested at most 32 deep", () => {
  const src = "[" + "[".repeat(N) + "x" + "]{color=red}".repeat(N) + "](u)";
  assert.ok(renders(src).length > 0);
  assert.ok(depth(firstParagraph(src)) <= 33);
});

test("limits: 15000 alternating ++ and == marks return", () => {
  renders("++a ==b ".repeat(N) + "x" + " b== a++".repeat(N));
  renders("++==".repeat(N) + "x" + "==++".repeat(N));
});

test("limits: 15000 nested emphasis, strong and strikethrough return, at most 32 deep", () => {
  for (const src of ["*a ".repeat(N) + "x" + " a*".repeat(N), "**".repeat(N) + "x" + "**".repeat(N), "~a ".repeat(N) + "x" + " a~".repeat(N)]) {
    renders(src);
    assert.ok(depth(firstParagraph(src)) <= 32, src.slice(0, 6));
  }
});

test("limits: nesting below the limit is parsed as usual", () => {
  const src = "![".repeat(32) + "x" + "](u.png)".repeat(32);
  assert.equal(depth(firstParagraph(src)), 32);
  assert.equal(renders(src), '<p><img src="u.png" alt="x"></p>\n');
  // One more level: the outermost brackets stay literal text.
  const deeper = "![".repeat(33) + "x" + "](u.png)".repeat(33);
  assert.equal(renders(deeper), '<p>![<img src="u.png" alt="x">](u.png)</p>\n');
  const emph = "*a ".repeat(32) + "x" + " a*".repeat(32);
  assert.equal(depth(firstParagraph(emph)), 32);
  assert.equal(depth(firstParagraph("*a ".repeat(33) + "x" + " a*".repeat(33))), 32);
});

test("limits: mixed deep nesting of spans, emphasis, marks and images in every combination returns", () => {
  const parts = [["[", "]{color=red}"], ["*a ", " a*"], ["![", "](u)"], ["==", "=="], ["++", "++"], ["~~", "~~"], ["[", "](u)"], ["**", "**"]];
  let open = "";
  let close = "";
  for (let i = 0; i < 4000; i++) {
    const [o, c] = parts[(i * 7) % parts.length];
    open += o;
    close = c + close;
  }
  renders(open + "x" + close);
  renders(">".repeat(N) + " x");
  renders(Array.from({ length: 3000 }, (_, i) => " ".repeat(i * 2) + "- x").join("\n"));
});

test("limits: a 1 MB note finishes in a few seconds", () => {
  const unit =
    "# Heading [x]{color=red}\n{bg=mint}\n\n" +
    "A **bold** *italic* ~~gone~~ `code` [link](https://example.com) www.example.com ++u++ ==h== " +
    "[span **x**]{font=\"Inter\" size=large} ![img](a.png) foo@bar.example.com \\* &amp;\n" +
    "second line with *unclosed and [brackets and `ticks and ++marks\n\n" +
    "- [x] task\n  - nested ==mark==\n\n| a | b |\n|:-|-:|\n| [c]{bg=red} | d \\| e |\n\n> quote\n\n";
  const src = unit.repeat(Math.ceil(1_000_000 / unit.length));
  assert.ok(src.length >= 1_000_000);
  const start = performance.now();
  const out = renderNote(src).html;
  const ms = performance.now() - start;
  assert.ok(out.length > src.length / 2);
  assert.ok(ms < 5000, `took ${Math.round(ms)} ms`);
});

test("limits: 1 MB of a single paragraph of delimiters and brackets finishes in a few seconds", () => {
  for (const unit of ["[a ", "*a ", "++a ", "`a ", "<a ", "![a](", "a_b ", "www.a.com ", "[x]{c=d} "]) {
    const src = unit.repeat(Math.ceil(1_000_000 / unit.length));
    const start = performance.now();
    renderNote(src);
    const ms = performance.now() - start;
    assert.ok(ms < 5000, `${JSON.stringify(unit)} took ${Math.round(ms)} ms`);
  }
});
