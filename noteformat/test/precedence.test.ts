// SPEC 5.5 Which style wins. The renderer emits markup, and the theme the CSS, that make each
// rule hold; see README.md "How SPEC 5.5 holds in the rendered HTML".

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderNote } from "../src/index.ts";
import { renderPage } from "../src/cli.ts";
import { html, p, span } from "./helpers.ts";

const theme = readFileSync(new URL("../theme/paper.css", import.meta.url), "utf8");

/** The declarations the theme gives `selector` (rules whose selector list holds it, in order). */
function themeRule(selector: string): Record<string, string> {
  const css = theme.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(",").map((x) => x.trim().replace(/\s+/g, " "));
    if (!selectors.includes(selector)) continue;
    for (const decl of m[2].split(";")) {
      const i = decl.indexOf(":");
      if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
    }
  }
  return out;
}
const page = (src: string) => {
  const r = renderNote(src);
  return renderPage(r, "paper.css");
};

test("5.5 font: theme < front matter < block attribute line < styled span", () => {
  const out = page("---\nfont: Georgia\n---\nA [b]{font=mono} c\n{font=serif}\n\nD");
  // Front matter on the note's body element, the block line on <p>, the span on <span>:
  // each inner element overrides the outer one by CSS inheritance.
  assert.match(out, /<article class="note" style="font-family: 'Georgia'">/);
  assert.match(out, /<p style="font-family: var\(--note-font-serif\)">A <span style="font-family: var\(--note-font-mono\)">b<\/span> c<\/p>/);
  assert.match(out, /<p>D<\/p>/);
  // The theme's font is on .note, which the front matter's inline style overrides.
  assert.match(theme, /\.note \{[^}]*font-family: var\(--note-font-serif\)/);
  // Headings inherit the note's font instead of setting their own.
  assert.match(theme, /\.note h6 \{\n  font-family: inherit;/);
});

test("5.5 font: a span's or block's font is stronger than the theme's code font", () => {
  assert.match(theme, /\.note span\[style\*="font-family:"\] code,\n\.note p\[style\*="font-family:"\] code,/);
  assert.equal(themeRule('.note span[style*="font-family:"] code')["font-family"], "inherit");
  assert.equal(themeRule('.note h2[style*="font-family:"] code')["font-family"], "inherit");
  // The rendered HTML puts the code inside the element that carries the font.
  assert.equal(html("[`x`]{font=serif}"), p(span("font-family: var(--note-font-serif)", "<code>x</code>")));
  assert.equal(html("Run `x`\n{font=mono}"), '<p style="font-family: var(--note-font-mono)">Run <code>x</code></p>\n');
});

test("5.5 font: the front matter font does not apply to code (SPEC 3, font)", () => {
  const out = page("---\nfont: Georgia\n---\nRun `x` now");
  assert.match(out, /<article class="note" style="font-family: 'Georgia'">\n<p>Run <code>x<\/code> now<\/p>/);
  assert.equal(themeRule(".note code")["font-family"], "var(--note-font-mono)");
  // The article is not among the elements whose font code inherits.
  assert.deepEqual(themeRule('.note [style*="font-family:"] code'), {});
});

test("5.5 color: theme < block attribute line < styled span, and the front matter has no colour", () => {
  assert.equal(html("A [b]{color=red} c\n{color=blue}"), '<p style="color: var(--note-blue)">A ' + span("color: var(--note-red)", "b") + " c</p>\n");
});

test("5.5 color: a span's colour is stronger than the theme's link colour", () => {
  assert.equal(html("[see [g](/u)]{color=red}"), p(span("color: var(--note-red)", 'see <a href="/u">g</a>')));
  // color is always the first declaration, and the theme lets a coloured ancestor win.
  assert.match(theme, /\.note \[style\^="color:"\] a \{\n  color: inherit;/);
  assert.match(theme, /\.note mark \{[^}]*color: inherit;/);
  assert.equal(themeRule('.note [style^="color:"] a').color, "inherit");
  assert.equal(themeRule(".note mark").color, "inherit");
  // In the HTML, color is the first declaration of every element that sets it.
  assert.equal(html("[g](/u)\n{color=red bg=mint}"), '<p style="color: var(--note-red); background-color: var(--note-mint)"><a href="/u">g</a></p>\n');
  assert.equal(html("[==x== [g](/u)]{bg=mint color=blue}"),
    p(span("color: var(--note-blue); background-color: var(--note-mint)", '<mark style="background-color: var(--note-mint)">x</mark> <a href="/u">g</a>')));
});

test("5.5 a stronger level overrides a weaker one for that property only", () => {
  assert.equal(
    html("A [b]{color=red} c\n{color=blue font=mono}"),
    '<p style="color: var(--note-blue); font-family: var(--note-font-mono)">A ' + span("color: var(--note-red)", "b") + " c</p>\n",
  );
});

test("5.5 size: theme < front matter < block attribute line < span, named sizes multiplying", () => {
  const out = page("---\nsize: large\n---\nA [b]{size=xl} c\n{size=small}");
  assert.match(out, /<article class="note" style="font-size: calc\(var\(--note-body-size, 1rem\) \* 1.25\)">/);
  assert.match(out, /<p style="font-size: 0.875em">A <span style="font-size: 1.5em">b<\/span> c<\/p>/);
  assert.match(page("---\nsize: 17px\n---\nx"), /<article class="note" style="font-size: 17px">/);
});

test("5.5 background: block attribute line < == mark < styled span", () => {
  // The mark paints over the paragraph's background; the span paints over the mark's.
  assert.equal(html("A ==b== c\n{bg=mint}"), '<p style="background-color: var(--note-mint)">A <mark>b</mark> c</p>\n');
  assert.equal(html("==a [b]{bg=red} c=="), p("<mark>a " + span("background-color: var(--note-red)", "b") + " c</mark>"));
});

test("5.5 background: ==[x]{bg=red}== and [==x==]{bg=red} both show x on red", () => {
  assert.equal(html("==[x]{bg=red}=="), p("<mark>" + span("background-color: var(--note-red)", "x") + "</mark>"));
  // A mark inside a span with bg takes the span's background instead of the highlight colour.
  assert.equal(
    html("[==x==]{bg=red}"),
    p(span("background-color: var(--note-red)", '<mark style="background-color: var(--note-red)">x</mark>')),
  );
  assert.equal(
    html("[a **==x==**]{bg=highlight}"),
    p(span("background-color: var(--note-highlight)", 'a <strong><mark style="background-color: var(--note-highlight)">x</mark></strong>')),
  );
  // A span without bg does not change a mark inside it.
  assert.equal(html("[==x==]{color=red}"), p(span("color: var(--note-red)", "<mark>x</mark>")));
});

test("5.5 underline rule 1: text inside a ++ mark is underlined", () => {
  assert.equal(html("++a [b]{underline=no} c++"), p("<u>a " + span("text-decoration: none", "b") + " c</u>"));
  // <u> paints the underline; a descendant's text-decoration: none cannot remove it.
  assert.equal(html("[++x++]{underline=no}"), p(span("text-decoration: none", "<u>x</u>")));
});

test("5.5 underline rule 2: inside a span that sets a valid underline, that value decides", () => {
  assert.equal(html("[x]{underline=yes}"), p(span("text-decoration: underline", "x")));
  assert.equal(html("A [x]{underline=yes} b\n{underline=no}"), '<p style="text-decoration: none">A ' + span("text-decoration: underline", "x") + " b</p>\n");
  assert.equal(html("[x]{underline=maybe}"), p("<span>x</span>"));
});

test("5.5 underline rule 3: a block attribute line that sets a valid underline decides", () => {
  assert.equal(html("A b\n{underline=yes}"), '<p style="text-decoration: underline">A b</p>\n');
  assert.equal(html("# H\n{underline=yes}"), '<h1 style="text-decoration: underline">H</h1>\n');
});

test("5.5 underline rule 4: otherwise text is not underlined, links included", () => {
  assert.equal(html("plain [link](/u)"), p('plain <a href="/u">link</a>'));
  assert.match(theme, /\.note a \{[^}]*text-decoration: none;/);
  assert.equal(themeRule(".note a")["text-decoration"], "none");
  assert.equal(html("[l](/u) and <https://e.example>"), p('<a href="/u">l</a> and <a href="https://e.example">https://e.example</a>'));
});

test("5.5 underline=no on a span cancels a block-level underline for that span", () => {
  assert.equal(
    html("A [b]{underline=no} c\n{underline=yes}"),
    '<p><span style="text-decoration: underline">A </span>' + span("text-decoration: none", "b") + '<span style="text-decoration: underline"> c</span></p>\n',
  );
  // The other declarations of the line stay on the block element.
  assert.equal(
    html("A [b]{underline=no}\n{color=red underline=yes}"),
    '<p style="color: var(--note-red)"><span style="text-decoration: underline">A </span>' + span("text-decoration: none", "b") + "</p>\n",
  );
});

test("5.5 underline=no cancels a block underline inside emphasis, links and highlight too", () => {
  assert.equal(
    html("**a [b]{underline=no}** ==c==\n{underline=yes}"),
    '<p><strong><span style="text-decoration: underline">a </span>' +
      span("text-decoration: none", "b") +
      '</strong><span style="text-decoration: underline"> <mark>c</mark></span></p>\n',
  );
  assert.equal(
    html("[a [b]{underline=no}](/u)\n{underline=yes}"),
    '<p><a href="/u"><span style="text-decoration: underline">a </span>' + span("text-decoration: none", "b") + "</a></p>\n",
  );
});

test("5.5 underline=no has no effect inside a ++ mark, even under a block underline", () => {
  assert.equal(
    html("++a [b]{underline=no}++\n{underline=yes}"),
    '<p style="text-decoration: underline"><u>a ' + span("text-decoration: none", "b") + "</u></p>\n",
  );
});

test("5.5 code inside a span or block shows that span's or block's colour, background and font", () => {
  assert.equal(html("[`x`]{bg=red}"), p(span("background-color: var(--note-red)", "<code>x</code>")));
  assert.equal(html("[`x`]{color=red}"), p(span("color: var(--note-red)", "<code>x</code>")));
  assert.equal(html("Run `x`\n{bg=mint}"), '<p style="background-color: var(--note-mint)">Run <code>x</code></p>\n');
  // The theme gives code no colour, and gives up its background inside a background.
  assert.equal(themeRule(".note code").color, undefined);
  for (const sel of ['.note span[style*="background-color:"] code', '.note p[style*="background-color:"] code', '.note h1[style*="background-color:"] code', ".note mark code"]) {
    assert.equal(themeRule(sel).background, "transparent", sel);
  }
});

test("5.5 an image placeholder inside a span or block shows its colour, background and font", () => {
  assert.equal(
    html("[see ![map](https://e.example/m.png)]{color=red bg=mint font=mono}"),
    p(span("color: var(--note-red); background-color: var(--note-mint); font-family: var(--note-font-mono)",
      'see <span class="note-image-placeholder" data-src="https://e.example/m.png">map</span>')),
  );
  assert.equal(themeRule(".note .note-image-placeholder").color, "inherit");
  assert.equal(themeRule(".note .note-image-placeholder::before").color, undefined);
  assert.equal(themeRule(".note .note-image-placeholder::after").color, undefined);
  assert.equal(themeRule('.note span[style*="background-color:"] .note-image-placeholder').background, "transparent");
  assert.equal(themeRule('.note p[style*="background-color:"] .note-image-placeholder').background, "transparent");
  assert.equal(themeRule('.note span[style*="font-family:"] .note-image-placeholder')["font-family"], "inherit");
  assert.equal(themeRule('.note span[style*="font-family:"] .note-image-placeholder::after')["font-family"], "inherit");
  assert.equal(themeRule('.note h3[style*="font-family:"] .note-image-placeholder')["font-family"], "inherit");
});
