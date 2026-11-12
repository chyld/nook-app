// SPEC 4 Base syntax: ordinary CommonMark 0.31.2 and the GFM extensions (tables,
// strikethrough, task list items, extended autolinks), so that a regression in the base is seen.

import { test } from "node:test";
import assert from "node:assert/strict";
import MarkdownIt from "markdown-it";
import { html, p } from "./helpers.ts";

test("4 paragraphs, soft and hard line breaks", () => {
  assert.equal(html("aaa\nbbb\n\nccc"), p("aaa\nbbb") + p("ccc"));
  assert.equal(html("foo  \nbar"), p("foo<br>\nbar"));
  assert.equal(html("foo\\\nbar"), p("foo<br>\nbar"));
  assert.equal(html("  aaa\n bbb"), p("aaa\nbbb"));
  assert.equal(html("foo  "), p("foo"));
});

test("4 ATX and setext headings", () => {
  assert.equal(html("# h1\n## h2\n###### h6\n####### no"), "<h1>h1</h1>\n<h2>h2</h2>\n<h6>h6</h6>\n" + p("####### no"));
  assert.equal(html("# foo #\n## bar ##   \n# foo#"), "<h1>foo</h1>\n<h2>bar</h2>\n<h1>foo#</h1>\n");
  assert.equal(html("#5 bolt"), p("#5 bolt"));
  assert.equal(html("Foo *bar*\n===\n\nBaz\n---"), "<h1>Foo <em>bar</em></h1>\n<h2>Baz</h2>\n");
});

test("4 thematic breaks", () => {
  assert.equal(html("***\n---\n___\n* * *"), "<hr>\n<hr>\n<hr>\n<hr>\n");
});

test("4 emphasis, strong emphasis and their CommonMark rules", () => {
  assert.equal(html("*a* _b_ **c** __d__ ***e***"), p("<em>a</em> <em>b</em> <strong>c</strong> <strong>d</strong> <em><strong>e</strong></em>"));
  assert.equal(html("foo_bar_baz 5*6*78"), p("foo_bar_baz 5<em>6</em>78"));
  assert.equal(html("*foo**bar**baz*"), p("<em>foo<strong>bar</strong>baz</em>"));
  assert.equal(html("*foo**bar*"), p("<em>foo**bar</em>"));
  assert.equal(html("**foo*"), p("*<em>foo</em>"));
  assert.equal(html("a * foo bar*"), p("a * foo bar*"));
  assert.equal(html("*(*foo*)*"), p("<em>(<em>foo</em>)</em>"));
  assert.equal(html("пристаням_стремятся_"), p("пристаням_стремятся_"));
});

test("4 code spans", () => {
  assert.equal(html("`foo` `` a ` b `` ` `` `"), p("<code>foo</code> <code>a ` b</code> <code>``</code>"));
  assert.equal(html("`foo\nbar`"), p("<code>foo bar</code>"));
  assert.equal(html("`foo\\`bar`"), p("<code>foo\\</code>bar`"));
  assert.equal(html("```foo``"), p("```foo``"));
});

test("4 links: inline, reference, collapsed, shortcut, titles", () => {
  assert.equal(html('[a](/u "t")'), p('<a href="/u" title="t">a</a>'));
  assert.equal(html("[a](<my uri>)"), p('<a href="my%20uri">a</a>'));
  assert.equal(html("[a](foo(and(bar)))"), p('<a href="foo(and(bar))">a</a>'));
  assert.equal(html("[a]()"), p('<a href="">a</a>'));
  assert.equal(html("[Foo][BaR]\n\n[bar]: /url 'T'"), p('<a href="/url" title="T">Foo</a>'));
  assert.equal(html("[foo][]\n\n[foo]: /url"), p('<a href="/url">foo</a>'));
  assert.equal(html("[foo] bar\n\n[foo]: /url"), p('<a href="/url">foo</a> bar'));
  assert.equal(html("[link [foo [bar]]](/uri)"), p('<a href="/uri">link [foo [bar]]</a>'));
  assert.equal(html("[link](/u\\(x\\))"), p('<a href="/u(x)">link</a>'));
  assert.equal(html("[a](/u&amp;v)"), p('<a href="/u&amp;v">a</a>'));
  assert.equal(html("[a](/ü)"), p('<a href="/%C3%BC">a</a>'));
});

test("4 images", () => {
  assert.equal(html("![foo *bar*](train.jpg \"t\")"), p('<img src="train.jpg" alt="foo bar" title="t">'));
  assert.equal(html("[![moon](moon.jpg)](/uri)"), p('<a href="/uri"><img src="moon.jpg" alt="moon"></a>'));
});

test("4 autolinks: URI and email; HTML is not recognised", () => {
  assert.equal(html("<http://foo.bar.baz>"), p('<a href="http://foo.bar.baz">http://foo.bar.baz</a>'));
  assert.equal(html("<foo@bar.example.com>"), p('<a href="mailto:foo@bar.example.com">foo@bar.example.com</a>'));
  assert.equal(html("<b>bold</b> <!-- c --> <div>"), p("&lt;b&gt;bold&lt;/b&gt; &lt;!-- c --&gt; &lt;div&gt;"));
  assert.equal(html("<div>\n</div>"), p("&lt;div&gt;\n&lt;/div&gt;"));
});

test("4 entity and numeric character references", () => {
  assert.equal(html("&copy; &amp; &#35; &#x22; &#0; &nosuch; &copy"), p("© &amp; # &quot; \uFFFD &amp;nosuch; &amp;copy"));
  assert.equal(html("&#42;not emphasis&#42;"), p("*not emphasis*"));
});

test("4 backslash escapes", () => {
  assert.equal(html("\\*\\_\\`\\#\\[\\]\\<\\>"), p("*_`#[]&lt;&gt;"));
});

test("4 block quotes, with lazy continuation", () => {
  assert.equal(html("> # Foo\n> bar\nbaz"), "<blockquote>\n<h1>Foo</h1>\n" + p("bar\nbaz") + "</blockquote>\n");
  assert.equal(html("> a\n>\n> b"), "<blockquote>\n" + p("a") + p("b") + "</blockquote>\n");
});

test("4 lists: bullet, ordered with start, tight and loose, nested", () => {
  assert.equal(html("- a\n- b"), "<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n");
  assert.equal(html("- a\n\n- b"), "<ul>\n<li>\n<p>a</p>\n</li>\n<li>\n<p>b</p>\n</li>\n</ul>\n");
  assert.equal(html("3. a\n4. b"), '<ol start="3">\n<li>a</li>\n<li>b</li>\n</ol>\n');
  assert.equal(html("1) a"), "<ol>\n<li>a</li>\n</ol>\n");
  assert.equal(html("- a\n  - b\n- c"), "<ul>\n<li>a\n<ul>\n<li>b</li>\n</ul>\n</li>\n<li>c</li>\n</ul>\n");
  assert.equal(html("- a\n+ b"), "<ul>\n<li>a</li>\n</ul>\n<ul>\n<li>b</li>\n</ul>\n");
  assert.equal(html("-\n  foo"), "<ul>\n<li>foo</li>\n</ul>\n");
});

test("4 code blocks: indented and fenced, with an info string", () => {
  assert.equal(html("    a <b>\n    c"), "<pre><code>a &lt;b&gt;\nc\n</code></pre>\n");
  assert.equal(html("```python extra\nx = 1\n```"), '<pre><code class="language-python">x = 1\n</code></pre>\n');
  assert.equal(html("~~~\n```\n~~~"), "<pre><code>```\n</code></pre>\n");
  assert.equal(html("``` a\\_b\n```"), '<pre><code class="language-a_b"></code></pre>\n');
});

test("4 GFM tables: alignment, escaped pipes, missing and excess cells, end of table", () => {
  assert.equal(
    html("| a | b | c |\n|:-|:-:|-:|\n| 1 | 2 | 3 |"),
    "<table>\n<thead>\n<tr>\n" +
      '<th style="text-align: left">a</th>\n<th style="text-align: center">b</th>\n<th style="text-align: right">c</th>\n' +
      "</tr>\n</thead>\n<tbody>\n<tr>\n" +
      '<td style="text-align: left">1</td>\n<td style="text-align: center">2</td>\n<td style="text-align: right">3</td>\n' +
      "</tr>\n</tbody>\n</table>\n",
  );
  assert.equal(
    html("| f\\|oo |\n| --- |\n| b `\\|` az |"),
    "<table>\n<thead>\n<tr>\n<th>f|oo</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>b <code>|</code> az</td>\n</tr>\n</tbody>\n</table>\n",
  );
  assert.equal(
    html("| a | b |\n| - | - |\n| c |\n| d | e | f |"),
    "<table>\n<thead>\n<tr>\n<th>a</th>\n<th>b</th>\n</tr>\n</thead>\n<tbody>\n" +
      "<tr>\n<td>c</td>\n<td></td>\n</tr>\n<tr>\n<td>d</td>\n<td>e</td>\n</tr>\n</tbody>\n</table>\n",
  );
  assert.equal(html("| a |\n| - |"), "<table>\n<thead>\n<tr>\n<th>a</th>\n</tr>\n</thead>\n</table>\n");
  // \\ is an escaped backslash and the | after it separates cells (GFM), both for the table's
  // structure and for its cells.
  assert.equal(
    html("| a \\\\| b |\n|---|---|"),
    "<table>\n<thead>\n<tr>\n<th>a \\</th>\n<th>b</th>\n</tr>\n</thead>\n</table>\n",
  );
  // Three header cells over two delimiter cells: not a table.
  assert.equal(html("| a \\\\| b | c |\n|---|---|"), p("| a \\| b | c |\n|---|---|"));
  assert.equal(
    html("| h |\n|---|\n| x \\\\| y |"),
    "<table>\n<thead>\n<tr>\n<th>h</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>x \\</td>\n</tr>\n</tbody>\n</table>\n",
  );
  assert.equal(
    html("| a |\n| - |\n| b |\n\nafter"),
    "<table>\n<thead>\n<tr>\n<th>a</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>b</td>\n</tr>\n</tbody>\n</table>\n" + p("after"),
  );
});

test("4 GFM strikethrough: one or two tildes; three or more is literal", () => {
  assert.equal(html("~~Hi~~ Hello, ~there~ world!"), p("<del>Hi</del> Hello, <del>there</del> world!"));
  assert.equal(html("This will ~~~not~~~ strike."), p("This will ~~~not~~~ strike."));
  assert.equal(html("~~a~"), p("~~a~"));
  assert.equal(html("This ~~has a\n\nnew paragraph~~."), p("This ~~has a") + p("new paragraph~~."));
});

test("4 GFM task list items, in tight and loose lists and ordered lists", () => {
  assert.equal(html("- [ ] foo\n- [x] bar"), '<ul>\n<li><input type="checkbox" disabled> foo</li>\n<li><input type="checkbox" disabled checked> bar</li>\n</ul>\n');
  assert.equal(html("- [x] a\n\n- [ ] b"), '<ul>\n<li>\n<p><input type="checkbox" disabled checked> a</p>\n</li>\n<li>\n<p><input type="checkbox" disabled> b</p>\n</li>\n</ul>\n');
  assert.equal(html("1. [X] done"), '<ol>\n<li><input type="checkbox" disabled checked> done</li>\n</ol>\n');
  assert.equal(html("- [ ]"), "<ul>\n<li>[ ]</li>\n</ul>\n");
  assert.equal(html("[ ] not in a list"), p("[ ] not in a list"));
});

test("4 GFM extended autolinks", () => {
  assert.equal(html("www.commonmark.org/a.b."), p('<a href="http://www.commonmark.org/a.b">www.commonmark.org/a.b</a>.'));
  assert.equal(html("http://commonmark.org"), p('<a href="http://commonmark.org">http://commonmark.org</a>'));
  assert.equal(html("foo@bar.baz"), p('<a href="mailto:foo@bar.baz">foo@bar.baz</a>'));
  assert.equal(html("a.b-c_d@a.b."), p('<a href="mailto:a.b-c_d@a.b">a.b-c_d@a.b</a>.'));
  assert.equal(html("a.b-c_d@a.b-"), p("a.b-c_d@a.b-"));
  // SPEC 5 pass 3: only http://, https://, www. and email addresses start a bare URL.
  assert.equal(html("ftp://example.com/path"), p("ftp://example.com/path"));
  assert.equal(html("mailto:foo@bar.baz"), p("mailto:foo@bar.baz"));
  assert.equal(html("xmpp:foo@bar.baz"), p("xmpp:foo@bar.baz"));
});

test("4 links to javascript:, vbscript:, file: and data: URLs get no href", () => {
  assert.equal(html("[x](javascript:alert(1))"), p("<a>x</a>"));
  assert.equal(html("<javascript:alert(1)>"), p("<a>javascript:alert(1)</a>"));
});

// A differential check: for inputs that use none of the extras, the inline and block output must
// match markdown-it's own CommonMark renderer (an independent CommonMark implementation), after
// the void-tag spelling is normalised.
const PURE_COMMONMARK = [
  "*foo**bar**baz*", "**foo*bar*baz**", "***strong emph***", "*foo _bar* baz_", "__foo, __bar__, baz__", "*foo**bar*",
  "foo*bar*", "5*6*78", "_foo_bar", "*(*foo*)*", "**foo \"*bar*\" foo**", "*foo *bar**", "a * foo bar*", "*$*alpha.",
  "**Gomphocarpus (*Gomphocarpus physocarpus*, syn.\n*Asclepias physocarpa*)**", "foo***bar***baz", "foo******bar*********baz",
  "*foo [bar](/url)*", "_____foo_____", "**foo*", "*foo**", "__foo_ bar_", "*a `*`*", "_a `_`_", "**a<http://foo.bar/?q=**>",
  "`` foo ` bar ``", "` `` `", "`  ``  `", "``\nfoo\nbar  \nbaz\n``", "`foo   bar \nbaz`", "`foo",
  "\\!\\\"\\#\\$\\%\\&\\'\\(\\)\\*\\+\\,\\-\\.\\/\\:\\;\\<\\=\\>\\?\\@\\[\\\\\\]\\^\\_\\`\\{\\|\\}\\~", "\\\t\\A\\a\\ \\3\\φ\\«",
  "foo       \nbar", "foo \n baz", "&nbsp; &AElig; &Dcaron;", "&#1234; &#992;", "&#XD06; &#xcab;", "&nbsp &x; &#; &#x;", "&MadeUpEntity;",
  "[link](/my uri)", "[link](foo\nbar)", "[a](<b)c>)", "[link](<foo(and(bar)>)", "[link](foo\\)\\:)", "[link](#fragment)",
  "[link](foo\\bar)", "[link](foo%20b&auml;)", "[link](\"title\")", "[link](/url (title))", "[link](/url \"title \\\"&quot;\")",
  "[link](   /uri\n  \"title\"  )", "[link] (/uri)", "[link] bar](/uri)", "[link [bar](/uri)", "[link \\[bar](/uri)",
  "[link *foo **bar** `#`*](/uri)", "[foo [bar](/uri)](/uri)", "[foo *[bar [baz](/uri)](/uri)*](/uri)", "*[foo*](/uri)",
  "[foo *bar](baz*)", "*foo [bar* baz]", "[foo`](/uri)`", "[foo<http://example.com/?search=](uri)>",
  "[link [foo [bar]]][ref]\n\n[ref]: /uri", "[ẞ]\n\n[SS]: /url", "[foo] [bar]\n\n[bar]: /url", "[foo]\n[bar]\n\n[bar]: /url",
  "[bar][foo\\!]\n\n[foo!]: /url", "[*foo* bar][]\n\n[*foo* bar]: /url", "[foo] \n[]\n\n[foo]: /url", "[[*foo* bar]]\n\n[*foo* bar]: /url",
  "[[bar [foo]\n\n[foo]: /url", "\\[foo]\n\n[foo]: /url", "[foo*]: /url\n\n*[foo*]", "[foo][bar][baz]\n\n[baz]: /url",
  "[foo][bar][baz]\n\n[baz]: /url1\n[bar]: /url2", "<https://foo.bar.baz/test?q=hello&id=22&boolean>", "<irc://foo.bar:2233/baz>",
  "<MAILTO:FOO@BAR.BAZ>", "<a+b+c:d>", "<made-up-scheme://foo,bar>", "<http://../>", "<localhost:5001/foo>", "<http://foo.bar/baz bim>",
  "<http://example.com/\\[\\>", "<foo\\+@bar.example.com>", "<>", "<m:abc>", "<foo.bar.baz>", "<a><bab><c2c>", "<a href=\"foo\">",
  "\\## foo", "# foo *bar* \\*baz\\*", "#                  foo                     ", "## foo ##\n  ###   bar    ###", "### foo \\###", "## \n#\n### ###",
  "Foo\n= =", "- foo\n- bar\n+ baz", "1. foo\n2. bar\n3) baz", "- foo\n\n- bar\n\n\n- baz", "- a\n - b\n  - c\n   - d\n  - e\n - f\n- g",
  "1. a\n\n  2. b\n\n    3. c", "- a\n- b\n\n- c", "* a\n*\n\n* c", "- a\n  > b\n  ```\n  c\n  ```\n- d", "> bar\nbaz\n> foo", "    code\n  block",
  "```\n<\n >\n```", "~~~ruby startline=3 $%@#$\ndef foo(x)\n  return 3\nend\n~~~", "- foo\n  - bar\n    - baz\n\n\n      bim",
  "1. foo\n\n   ```\n   bar\n   ```\n\n   baz\n\n   > bam", "> ```\n> aaa\n\nbbb", ">     code\n\n>    not code", "*foo`*`", "**foo bar **",
  "** foo bar**", "__\\_foo__", "*\\*foo*", "\\*foo*", "foo \\\nbar\\", "a\u00a0*b*\u00a0c", "*a*\u3000b", "[foo]: /url \"title\"\n\n[foo]",
  "[foo]:\n/url\n\n[foo]", "[foo]: <bar>(baz)\n\n[foo]", "[foo]: /url 'title\n\nwith blank line'\n\n[foo]", "Foo\n[bar]: /baz\n\n[bar]",
  "- `one\n- two`", "aaa\n***\nbbb", "Foo\n    bar", "    foo\nbar", "1.  A paragraph\n    with two lines.\n\n        indented code\n\n    > A block quote.",
];

const md = new MarkdownIt("commonmark", { html: false });
md.validateLink = () => true;
const normalise = (s: string) => s.replace(/ \/>/g, ">");

test("4 CommonMark differential: pure CommonMark input renders as markdown-it's CommonMark renderer", () => {
  for (const src of PURE_COMMONMARK) {
    assert.equal(html(src), normalise(md.render(src)), JSON.stringify(src));
  }
});
