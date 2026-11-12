// SPEC 5 (introduction): the parse order, the bare URL pass, inline scopes and flanking.

import { test } from "node:test";
import assert from "node:assert/strict";
import { html, p, span } from "./helpers.ts";

test("5 step 2: the extras play no part in dividing the body into blocks", () => {
  assert.equal(html("[a\n\nb]{color=red}"), p("[a") + p("b]{color=red}"));
  assert.equal(html("==a\n\nb=="), p("==a") + p("b=="));
});

test("5 step 2: HTML blocks are off", () => {
  assert.equal(html("<div>\n*hi*\n</div>"), p("&lt;div&gt;\n<em>hi</em>\n&lt;/div&gt;"));
});

test("5 pass 3: bare URLs are found by the GFM rules: www., http(s)://, email addresses", () => {
  assert.equal(html("see www.example.com now"), p('see <a href="http://www.example.com">www.example.com</a> now'));
  assert.equal(html("see https://example.com/a?b=c#d now"), p('see <a href="https://example.com/a?b=c#d">https://example.com/a?b=c#d</a> now'));
  assert.equal(html("mail foo.bar+baz@example.co.uk."), p('mail <a href="mailto:foo.bar+baz@example.co.uk">foo.bar+baz@example.co.uk</a>.'));
});

test("5 pass 3: GFM extended autolink path validation (trailing punctuation, parentheses, entities)", () => {
  assert.equal(html("Visit www.commonmark.org."), p('Visit <a href="http://www.commonmark.org">www.commonmark.org</a>.'));
  assert.equal(html("(www.google.com/search?q=Markup+(business))"), p('(<a href="http://www.google.com/search?q=Markup+(business)">www.google.com/search?q=Markup+(business)</a>)'));
  assert.equal(html("www.google.com/search?q=commonmark&hl;"), p('<a href="http://www.google.com/search?q=commonmark">www.google.com/search?q=commonmark</a>&amp;hl;'));
  assert.equal(html("www.commonmark.org/he<lp"), p('<a href="http://www.commonmark.org/he">www.commonmark.org/he</a>&lt;lp'));
});

test("5 pass 3: GFM domains: at least one period, no underscore in the last two segments", () => {
  assert.equal(html("www.a_b.c_d.com"), p("www.a_b.c_d.com"));
  assert.equal(html("www.a_b.example.com"), p('<a href="http://www.a_b.example.com">www.a_b.example.com</a>'));
});

test("5 pass 3: a bare URL comes only at the start of a line, after whitespace, or after * _ ~ (", () => {
  assert.equal(html("xwww.example.com"), p("xwww.example.com"));
  assert.equal(html("_www.example.com_"), p('<em><a href="http://www.example.com">www.example.com</a></em>'));
});

test("5 pass 3: the start of an inline scope counts as the start of a line", () => {
  assert.equal(html("[www.example.com]{color=red}"), p(span("color: var(--note-red)", '<a href="http://www.example.com">www.example.com</a>')));
  assert.equal(html("==www.example.com=="), p('<mark><a href="http://www.example.com">www.example.com</a></mark>'));
});

test("5 pass 3: a bare URL ends before the ] of a span or the ++ of a mark", () => {
  assert.equal(html("[go https://example.com/x]{color=red}"), p(span("color: var(--note-red)", 'go <a href="https://example.com/x">https://example.com/x</a>')));
  assert.equal(html("++https://example.com/x++"), p('<u><a href="https://example.com/x">https://example.com/x</a></u>'));
});

test("5 pass 3: no bare URL is found in link text", () => {
  assert.equal(html("[www.example.com](/u)"), p('<a href="/u">www.example.com</a>'));
  assert.equal(html("[[www.example.com]{color=red}](/u)"), p('<a href="/u">' + span("color: var(--note-red)", "www.example.com") + "</a>"));
});

test("5 pass 3: the text of a bare URL takes no part in the emphasis pass", () => {
  // One link and no emphasis. GFM's trailing-punctuation rule leaves the final _ outside the
  // link (SPEC 1.0.1, section 5, pass 3).
  assert.equal(html("https://example.com/_draft_"), p('<a href="https://example.com/_draft">https://example.com/_draft</a>_'));
  assert.equal(html("https://example.com/_draft_/page"), p('<a href="https://example.com/_draft_/page">https://example.com/_draft_/page</a>'));
  assert.equal(html("https://example.com/_draft_/x"), p('<a href="https://example.com/_draft_/x">https://example.com/_draft_/x</a>'));
  assert.equal(html("https://example.com/*a*b"), p('<a href="https://example.com/*a*b">https://example.com/*a*b</a>'));
  // A trailing * is not part of the URL, so it can still close emphasis around the link.
  assert.equal(html("*https://example.com/x*"), p('<em><a href="https://example.com/x">https://example.com/x</a></em>'));
});

test("5 the mark pass runs before the bare URL pass: https://example.com/==go==", () => {
  assert.equal(html("https://example.com/==go=="), p('<a href="https://example.com/">https://example.com/</a><mark>go</mark>'));
});

test("5 a URL with == in such a position is written as a CommonMark autolink", () => {
  assert.equal(html("<https://example.com/==go==>"), p('<a href="https://example.com/==go==">https://example.com/==go==</a>'));
});

test("5 for inline parsing each table cell is a block of its own", () => {
  assert.equal(
    html("| a | b |\n|---|---|\n| ==x | y== |"),
    "<table>\n<thead>\n<tr>\n<th>a</th>\n<th>b</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>==x</td>\n<td>y==</td>\n</tr>\n</tbody>\n</table>\n",
  );
  assert.equal(
    html("| a | b |\n|---|---|\n| *x | y* |"),
    "<table>\n<thead>\n<tr>\n<th>a</th>\n<th>b</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>*x</td>\n<td>y*</td>\n</tr>\n</tbody>\n</table>\n",
  );
});

test("5 inline scope: delimiters of emphasis pair only within the same scope", () => {
  assert.equal(html("*a [b* c]{color=red}"), p("*a " + span("color: var(--note-red)", "b* c")));
  assert.equal(html("*a [b](/u)*"), p('<em>a <a href="/u">b</a></em>'));
  assert.equal(html("~~a ==b~~ c=="), p("~~a <mark>b~~ c</mark>"));
});

test("5 inline scope: emphasis never crosses the edge of a mark", () => {
  assert.equal(html("**a ==b** c=="), p("**a <mark>b** c</mark>"));
});

test("5 flanking looks at the characters next to the run in the source text", () => {
  // Inside a span, the * after [ has the punctuation [ before it in the source.
  assert.equal(html("[*a*]{color=red}"), p(span("color: var(--note-red)", "<em>a</em>")));
  // The ** closing after a code span is preceded by ` in the source.
  assert.equal(html("**`x`**"), p("<strong><code>x</code></strong>"));
  // A ++ next to a span: the character before is the } of the attribute list, not a letter.
  assert.equal(html("[a]{color=red}++b++"), p(span("color: var(--note-red)", "a") + "<u>b</u>"));
});

test("5 pass 3: the URL text is used as written; entity references are not decoded", () => {
  assert.equal(html("https://example.com/a&#65;b"), p('<a href="https://example.com/a&amp;#65;b">https://example.com/a&amp;#65;b</a>'));
  assert.equal(html("www.example.com/?q=1&amp;x=2"), p('<a href="http://www.example.com/?q=1&amp;amp;x=2">www.example.com/?q=1&amp;amp;x=2</a>'));
});

test("5 pass 3: only http://, https://, www. and email addresses start a bare URL", () => {
  assert.equal(html("ftp://example.com/path"), p("ftp://example.com/path"));
  assert.equal(html("mailto:foo@example.com"), p("mailto:foo@example.com"));
  assert.equal(html("irc://example.com"), p("irc://example.com"));
  assert.equal(html("HTTPS://example.com"), p("HTTPS://example.com"));
});
