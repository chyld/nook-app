// The behaviour chosen for each open point of SPEC-ISSUES.md, so that it is pinned down and
// visible, and for the points SPEC 1.0.1 settled (titled "SPEC 1.0.1").

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderNote } from "../src/index.ts";
import { html, p, span } from "./helpers.ts";

const placeholder = (src: string, alt: string) => `<span class="note-image-placeholder" data-src="${src}">${alt}</span>`;

test("SPEC 1.0.1 5 pass 3: https://example.com/_draft_ follows GFM trailing punctuation", () => {
  assert.equal(html("https://example.com/_draft_"), p('<a href="https://example.com/_draft">https://example.com/_draft</a>_'));
});

test("SPEC-ISSUES 1 (5 pass 3): no bare URL inside any scope nested in link text", () => {
  assert.equal(html("[==www.example.com==](/u)"), p('<a href="/u"><mark>www.example.com</mark></a>'));
});

test("SPEC-ISSUES 2 (6): classification uses the destination CommonMark gives", () => {
  assert.equal(html("![x](https&#58;//evil.example/x.png)"), p(placeholder("https://evil.example/x.png", "x")));
  assert.equal(html("![x](https&#58;//evil.example/x.png)", { allowRemoteImages: true }), p('<img src="https://evil.example/x.png" alt="x">'));
});

test("SPEC-ISSUES 3 (6): a %-decoded path that is not UTF-8 is not loaded", () => {
  assert.equal(html("![x](%FF.jpg)"), p(placeholder("%FF.jpg", "x")));
});

test("SPEC-ISSUES 4 (6): an unsupported image type is not loaded", () => {
  assert.equal(html("![x](diagram.svg)"), p(placeholder("diagram.svg", "x")));
});

test("SPEC 1.0.1 5.1: [X] is a checked task marker", () => {
  assert.equal(html("- [X] done"), '<ul>\n<li><input type="checkbox" disabled checked> done</li>\n</ul>\n');
});

test("SPEC 1.0.1 5.4: a line indented four spaces under a heading is an indented code block", () => {
  assert.equal(html("# H\n    {color=red}"), "<h1>H</h1>\n<pre><code>{color=red}\n</code></pre>\n");
});

test("SPEC-ISSUES 5 (5.4): an image paragraph with no width key keeps the line as text", () => {
  assert.equal(html("![x](a.png)\n{color=red}"), p('<img src="a.png" alt="x">\n{color=red}'));
});

test("SPEC-ISSUES 6 (5, 5.2): marks at a scope edge, emphasis by source characters", () => {
  assert.equal(html("[==x==]{color=red}"), p(span("color: var(--note-red)", "<mark>x</mark>")));
  assert.equal(html("[_x_]{color=red}"), p(span("color: var(--note-red)", "<em>x</em>")));
});

test("SPEC-ISSUES 7 (5.3): an empty or all-whitespace font name is invalid", () => {
  assert.equal(html('[x]{font=""}'), p("<span>x</span>"));
  assert.equal(html('[x]{font="   "}'), p("<span>x</span>"));
});

test("SPEC-ISSUES 8 (5.3): leading zeros are accepted, units are case-sensitive", () => {
  assert.equal(html("[x]{size=022px}"), p(span("font-size: 022px", "x")));
  assert.equal(html("![x](a.png)\n{width=070%}"), p('<img src="a.png" alt="x" style="width: 070%">'));
  assert.equal(html("[x]{size=22PX}"), p("<span>x</span>"));
});

test("SPEC-ISSUES 9 (3): an empty scalar is invalid; null and ~ are text", () => {
  assert.equal(renderNote("---\ntitle:\n---\n# Heading").meta.title, "Heading");
  assert.equal(renderNote('---\ntitle: ""\n---\n# Heading').meta.title, "Heading");
  assert.equal(renderNote("---\ntitle: null\n---\n# Heading").meta.title, "null");
  assert.equal(renderNote("---\ntitle: ~\n---\n# Heading").meta.title, "~");
});

test("SPEC-ISSUES 10 (3): YAML escapes are resolved and multi-line scalars folded", () => {
  assert.equal(renderNote('---\ntitle: "Caf\\u00e9"\n---\n').meta.title, "Café");
  assert.equal(renderNote("---\ntitle: Lisbon\n  trip\n---\n").meta.title, "Lisbon trip");
});

test("SPEC 1.0.1 3: only extended calendar dates and date-times are accepted", () => {
  for (const v of ["20261110", "2026-W45-2", "2026-11-10 09:30"]) {
    assert.equal(renderNote(`---\ncreated: ${v}\n---\n`).meta.created, undefined, v);
  }
});

test("SPEC-ISSUES 11 (3): the first non-empty level-1 heading at any depth", () => {
  assert.equal(renderNote("> # Quoted title\n\n# Real title").meta.title, "Quoted title");
  assert.equal(renderNote("#\n\n# Title").meta.title, "Title");
  assert.equal(renderNote("- # In a list").meta.title, "In a list");
});

test("SPEC 1.0.1 2: a lone CR is a line ending", () => {
  assert.equal(html("a\rb"), p("a\nb"));
  assert.equal(html("# H\r{color=red}"), '<h1 style="color: var(--note-red)">H</h1>\n');
});

test("SPEC-ISSUES 13 (5 pass 3): the GFM spec text: a period in the domain, the character before", () => {
  assert.equal(html("http://localhost:3000"), p("http://localhost:3000"));
  assert.equal(html("x:foo@bar.com"), p("x:foo@bar.com"));
  assert.equal(html("https://a.example/\\_x"), p('<a href="https://a.example/">https://a.example/</a>_x'));
});

test("SPEC-ISSUES 12 (5.5): links are not underlined by the theme", () => {
  assert.equal(html("[a link](/u)"), p('<a href="/u">a link</a>'));
});
