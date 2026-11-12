// SPEC 5.2 Shorthand marks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { html, p, span } from "./helpers.ts";

test("5.2 table: ++text++ is underline, rendered <u>", () => {
  assert.equal(html("++text++"), p("<u>text</u>"));
});

test("5.2 table: ==text== is highlight, rendered <mark>", () => {
  assert.equal(html("==text=="), p("<mark>text</mark>"));
});

test("5.2 delimiter run: only a run of exactly two characters can be a delimiter", () => {
  assert.equal(html("+++x+++ and ===y=== and +x+"), p("+++x+++ and ===y=== and +x+"));
  assert.equal(html("++++x++++"), p("++++x++++"));
});

test("5.2 delimiter run: a run is made of unescaped characters only", () => {
  // \+ is literal, so the run after it is a single + and cannot be a delimiter.
  assert.equal(html("\\+++x++"), p("+<u>x</u>"));
  assert.equal(html("\\++x++"), p("++x++"));
});

test("5.2 open: the character after must not be whitespace, the run not at the end of its scope", () => {
  assert.equal(html("++ x++"), p("++ x++"));
  assert.equal(html("x ++"), p("x ++"));
});

test("5.2 open: the character before must not be a letter or digit", () => {
  assert.equal(html("a++b++ c"), p("a++b++ c"));
  assert.equal(html("1++x++ and 2==y== c"), p("1++x++ and 2==y== c"));
  assert.equal(html("x==1 and y==2"), p("x==1 and y==2"));
  assert.equal(html("é==x=="), p("é==x=="));
  assert.equal(html("(==x==)"), p("(<mark>x</mark>)"));
});

test("5.2 close: the character before must not be whitespace, the run not at the start of its scope", () => {
  assert.equal(html("++x ++"), p("++x ++"));
  assert.equal(html("[++x]{color=red}"), p(span("color: var(--note-red)", "++x")));
});

test("5.2 close: the character after must not be a letter or digit", () => {
  assert.equal(html("++x++y"), p("++x++y"));
  assert.equal(html("++x++1 and ==y==2"), p("++x++1 and ==y==2"));
  assert.equal(html("++x++."), p("<u>x</u>."));
});

test("5.2 a missing character at the start or end of a scope is neither whitespace nor a letter or digit", () => {
  assert.equal(html("==x=="), p("<mark>x</mark>"));
  assert.equal(html("[==x==]{color=red}"), p(span("color: var(--note-red)", "<mark>x</mark>")));
});

test("5.2 pairing: the first run that can open pairs with the next run of the same character that can close", () => {
  assert.equal(html("++a ++b++ c++"), p("<u>a ++b</u> c++"));
});

test("5.2 pairing: runs of the other character in between are not paired at this level", () => {
  assert.equal(html("++a ==b++ c=="), p("<u>a ==b</u> c=="));
});

test("5.2 pairing: continues after the closing run; a run without a partner is literal", () => {
  assert.equal(html("++a++ ++b++ ==c"), p("<u>a</u> <u>b</u> ==c"));
});

test("5.2 pairing: a run that can open but finds no closer is literal, and the next run is tried", () => {
  assert.equal(html("==a ++b++"), p("==a <u>b</u>"));
  // Here the first run does find a closer: the second == cannot close (whitespace before it).
  assert.equal(html("==a ==b=="), p("<mark>a ==b</mark>"));
});

test("5.2 the content of a mark is an inline scope: it may hold a mark of the other kind", () => {
  assert.equal(html("==a ++b++ c=="), p("<mark>a <u>b</u> c</mark>"));
  assert.equal(html("++a ==b== c++"), p("<u>a <mark>b</mark> c</u>"));
});

test("5.2 a mark never contains one of its own kind directly", () => {
  assert.equal(html("==a ==b== c=="), p("<mark>a ==b</mark> c=="));
});

test("5.2 scopes are separate: in *a ++b* c++, b* c is underlined and both * are literal", () => {
  assert.equal(html("*a ++b* c++"), p("*a <u>b* c</u>"));
});

test("5.2 scopes are separate: a mark never crosses the edge of a span or a link", () => {
  assert.equal(html("[a ++b]{color=red} c++"), p(span("color: var(--note-red)", "a ++b") + " c++"));
  assert.equal(html("[a ==b](/u) c=="), p('<a href="/u">a ==b</a> c=='));
});

test("5.2 a mark may contain a styled span, and a span's content may contain marks", () => {
  assert.equal(html("++[x]{color=red}++"), p("<u>" + span("color: var(--note-red)", "x") + "</u>"));
  assert.equal(html("[++x++]{color=red}"), p(span("color: var(--note-red)", "<u>x</u>")));
});

test("5.2 a line made only of = under a paragraph is a setext heading underline, never a highlight", () => {
  assert.equal(html("Title\n=="), "<h1>Title</h1>\n");
  // A line of = under a paragraph is a heading underline even when the paragraph has marks.
  assert.equal(html("==a==\n=========="), "<h1><mark>a</mark></h1>\n");
  // Not under a paragraph, a line of = is ordinary text (runs longer than two are literal).
  assert.equal(html("\n=========="), p("=========="));
});

test("5.2 Examples: the six example lines", () => {
  assert.equal(html("++book by Friday++"), p("<u>book by Friday</u>"));
  assert.equal(html("==pack sunscreen=="), p("<mark>pack sunscreen</mark>"));
  assert.equal(html("++[underlined and red]{color=red}++"), p("<u>" + span("color: var(--note-red)", "underlined and red") + "</u>"));
  assert.equal(html("*italic with ++underline++ inside*"), p("<em>italic with <u>underline</u> inside</em>"));
  assert.equal(html("if x==1 and y==2"), p("if x==1 and y==2"));
  assert.equal(html("a++b++c"), p("a++b++c"));
});

test("5.2 accidental marks: A ==> B, then C <== D and use ++i here, not i++ pair", () => {
  assert.equal(html("A ==> B, then C <== D"), p("A <mark>&gt; B, then C &lt;</mark> D"));
  assert.equal(html("use ++i here, not i++"), p("use <u>i here, not i</u>"));
});

test("5.2 a backslash before the run prevents it: A \\==> B and use \\++i here", () => {
  assert.equal(html("A \\==> B, then C <== D"), p("A ==&gt; B, then C &lt;== D"));
  assert.equal(html("use \\++i here, not i++"), p("use ++i here, not i++"));
});

test("5.2 marks pair with emphasis around them: **==x==** and ==**x**==", () => {
  assert.equal(html("**==x==**"), p("<strong><mark>x</mark></strong>"));
  assert.equal(html("==**x**=="), p("<mark><strong>x</strong></mark>"));
});

test("5.2 marks are not recognised in code spans", () => {
  assert.equal(html("`++x++` ++`y`++"), p("<code>++x++</code> <u><code>y</code></u>"));
});
