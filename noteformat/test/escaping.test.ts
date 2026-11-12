// SPEC 5.6 Escaping and code.

import { test } from "node:test";
import assert from "node:assert/strict";
import { html, p, span } from "./helpers.ts";

test("5.6 CommonMark backslash escapes apply in inline text", () => {
  assert.equal(html("\\*a\\* \\# \\\\ \\_b\\_"), p("*a* # \\ _b_"));
  assert.equal(html("\\a \\é"), p("\\a \\é"));
});

test("5.6 a backslash before [ or ] makes it literal", () => {
  assert.equal(html("\\[x]{color=red}"), p("[x]{color=red}"));
  assert.equal(html("[x\\]{color=red}"), p("[x]{color=red}"));
  assert.equal(html("[a \\] b]{color=red}"), p(span("color: var(--note-red)", "a ] b")));
});

test("5.6 a backslash before { or } makes it literal", () => {
  assert.equal(html("[x]\\{color=red}"), p("[x]{color=red}"));
  assert.equal(html("Para\n\\{color=red}"), p("Para\n{color=red}"));
});

test("5.6 a backslash before + or = makes it literal", () => {
  assert.equal(html("\\++x++"), p("++x++"));
  assert.equal(html("==x\\=="), p("==x=="));
});

test("5.6 inside an attribute list only the rules of 5.3 apply", () => {
  assert.equal(html('[x]{font="a\\]b"}'), p(span("font-family: 'a\\\\]b'", "x")));
  assert.equal(html('[x]{font="a\\"b"}'), p(span("font-family: 'a&quot;b'", "x")));
});

test("5.6 nothing in section 5 is recognised inside inline code", () => {
  assert.equal(html("`[x]{color=red} ++u++ ==h== www.example.com`"), p("<code>[x]{color=red} ++u++ ==h== www.example.com</code>"));
});

test("5.6 nothing in section 5 is recognised inside fenced code blocks", () => {
  assert.equal(html("```\n[x]{color=red} ++u++\n```"), "<pre><code>[x]{color=red} ++u++\n</code></pre>\n");
  assert.equal(html("```\nPara\n{color=red}\n```"), "<pre><code>Para\n{color=red}\n</code></pre>\n");
});

test("5.6 nothing in section 5 is recognised inside indented code blocks", () => {
  assert.equal(html("    [x]{color=red} ==h==\n    {color=red}"), "<pre><code>[x]{color=red} ==h==\n{color=red}\n</code></pre>\n");
});

test("5.6 \\[ and \\] inside span content are literal brackets and do not end the span", () => {
  assert.equal(html("[a \\[ b \\] c]{color=red}"), p(span("color: var(--note-red)", "a [ b ] c")));
  assert.equal(html("[\\]]{color=red}"), p(span("color: var(--note-red)", "]")));
  assert.equal(html("[\\[x]{color=red}"), p(span("color: var(--note-red)", "[x")));
});
