// SPEC 5.1 Styled span: the scan pass, its Consequences, Content and Examples.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNote } from "../src/index.ts";
import { html, p, span } from "./helpers.ts";

const RED = "color: var(--note-red)";

test("5.1 scan pass: a code span is recognised at a backtick and its text is not scanned", () => {
  assert.equal(html("`[x]{color=red}`"), p("<code>[x]{color=red}</code>"));
});

test("5.1 scan pass: an autolink is recognised at < and its text is not scanned", () => {
  assert.equal(html("<https://a.example/[x]{color=red}>"), p('<a href="https://a.example/%5Bx%5D%7Bcolor=red%7D">https://a.example/[x]{color=red}</a>'));
});

test("5.1 scan pass: a ] with an empty stack is literal text", () => {
  assert.equal(html("a ] b"), p("a ] b"));
});

test("5.1 scan pass: test 1, a span needs [ and the { of an attribute list right after ]", () => {
  assert.equal(html("[x]{color=red}"), p(span(RED, "x")));
  assert.equal(html("[x]{color = red}"), p("[x]{color = red}"));
});

test("5.1 scan pass: test 1, the text between the brackets must not be empty", () => {
  assert.equal(html("[]{color=red}"), p("[]{color=red}"));
});

test("5.1 scan pass: test 1, the attribute list is consumed and not scanned", () => {
  assert.equal(html('[x]{font="[y]{color=red}"}'), p(span("font-family: '[y]{color=red}'", "x")));
});

test("5.1 scan pass: test 2, otherwise a CommonMark link or image (inline, full, collapsed, shortcut)", () => {
  const defs = "\n\n[r]: /ref";
  assert.equal(html("[a](/u)"), p('<a href="/u">a</a>'));
  assert.equal(html("[a][r]" + defs), p('<a href="/ref">a</a>'));
  assert.equal(html("[r][]" + defs), p('<a href="/ref">r</a>'));
  assert.equal(html("[r]" + defs), p('<a href="/ref">r</a>'));
});

test("5.1 scan pass: test 3, otherwise both brackets are literal text", () => {
  assert.equal(html("[a] b"), p("[a] b"));
});

test("5.1 scan pass: an opening bracket still on the stack at the end of the block is literal", () => {
  assert.equal(html("[a [b]{color=red}"), p("[a " + span(RED, "b")));
});

test("5.1 scan pass: a link cannot contain another link, but the enclosing brackets can still be a span", () => {
  assert.equal(html("[[a](/u)](/v)"), p('[<a href="/u">a</a>](/v)'));
  assert.equal(html("[[a](/u)]{color=red}"), p(span(RED, '<a href="/u">a</a>')));
});

test("5.1 Consequences: spans do not nest", () => {
  assert.equal(html("[a [b]{color=red} c]{bg=blue}"), p("[a " + span(RED, "b") + " c]{bg=blue}"));
});

test("5.1 Consequences: plain bracket pairs are harmless", () => {
  assert.equal(html("[see [1] for details]{color=red}"), p(span(RED, "see [1] for details")));
  assert.equal(html("[see [1] for details]{color=red}\n\n[1]: /url"), p(span(RED, 'see <a href="/url">1</a> for details')));
});

test("5.1 Consequences: code and link destinations are skipped", () => {
  assert.equal(html("[a `]` b]{color=red}"), p(span(RED, "a <code>]</code> b")));
  assert.equal(html("[x](u]v)"), p('<a href="u%5Dv">x</a>'));
});

test("5.1 Consequences: no space before the brace", () => {
  assert.equal(html("[text] {color=red}"), p("[text] {color=red}"));
});

test("5.1 Consequences: a span wins over a shortcut reference", () => {
  assert.equal(html("[yes]{color=green}\n\n[yes]: /url"), p(span("color: var(--note-green)", "yes")));
});

test("5.1 Consequences: a link that is already complete is not a span", () => {
  assert.equal(html("[text](url){color=red}"), p('<a href="url">text</a>{color=red}'));
});

test("5.1 Consequences: [a][b]{color=red} with [b] defined is a full reference link and literal braces", () => {
  assert.equal(html("[a][b]{color=red}\n\n[b]: /url"), p('<a href="/url">a</a>{color=red}'));
});

test("5.1 Consequences: [a][b]{color=red} with [b] undefined: [a] literal (defined or not), [b]{color=red} a span", () => {
  assert.equal(html("[a][b]{color=red}"), p("[a]" + span(RED, "b")));
  assert.equal(html("[a][b]{color=red}\n\n[a]: /url"), p("[a]" + span(RED, "b")));
});

test("5.1 Consequences: to style a link, put it inside a span", () => {
  assert.equal(html("[see [the guide](https://example.com)]{color=red}"), p(span(RED, 'see <a href="https://example.com">the guide</a>')));
});

test("5.1 Consequences: a span may be used inside link text", () => {
  assert.equal(html("[[red]{color=red} and plain](https://example.com)"), p('<a href="https://example.com">' + span(RED, "red") + " and plain</a>"));
});

test("5.1 Consequences: ![alt]{width=50%} is not a span; the braces are literal", () => {
  assert.equal(html("![alt]{width=50%}"), p("![alt]{width=50%}"));
});

test("5.1 Consequences: Wow![great]{color=red} is not a span; Wow\\![great]{color=red} is", () => {
  assert.equal(html("Wow![great]{color=red}"), p("Wow![great]{color=red}"));
  assert.equal(html("Wow\\![great]{color=red}"), p("Wow!" + span(RED, "great")));
});

test("5.1 Consequences: a task list marker needs a following space or tab; - [x]{color=red} done is a span", () => {
  assert.equal(html("- [x] done"), '<ul>\n<li><input type="checkbox" disabled checked> done</li>\n</ul>\n');
  assert.equal(html("- [ ]\ttodo"), '<ul>\n<li><input type="checkbox" disabled> todo</li>\n</ul>\n');
  assert.equal(html("- [x]{color=red} done"), "<ul>\n<li>" + span(RED, "x") + " done</li>\n</ul>\n");
  const note = parseNote("- [x]{color=red} done");
  const list = note.children[0];
  assert.ok(list.type === "list" && list.children[0].task === undefined);
});

test("5.1 Consequences: a task marker is taken in step 2 and is never inline text", () => {
  const note = parseNote("- [x] done");
  const list = note.children[0];
  assert.ok(list.type === "list");
  const item = list.children[0];
  assert.deepEqual(item.task, { checked: true, range: { start: 2, end: 5 } });
  const para = item.children[0];
  assert.ok(para.type === "paragraph");
  assert.deepEqual(para.children, [{ type: "text", value: "done", range: { start: 6, end: 10 } }]);
});

test("5.1 Content: bold, italic, strikethrough, code, links, images and marks inside a span", () => {
  assert.equal(
    html("[**b** *i* ~~s~~ `c` [l](/u) ![m](m.png) ++u++ ==h==]{color=red}"),
    p(span(RED, '<strong>b</strong> <em>i</em> <del>s</del> <code>c</code> <a href="/u">l</a> <img src="m.png" alt="m"> <u>u</u> <mark>h</mark>')),
  );
});

test("5.1 Content: the content is an inline scope, so **a [b** c]{color=red} leaves both ** literal", () => {
  assert.equal(html("**a [b** c]{color=red}"), p("**a " + span(RED, "b** c")));
});

test("5.1 Content: content may continue over a line break inside a paragraph", () => {
  assert.equal(html("[line one\nline two]{color=red}"), p(span(RED, "line one\nline two")));
});

test("5.1 Content: content cannot cross a block boundary", () => {
  assert.equal(html("[line one\n\nline two]{color=red}"), p("[line one") + p("line two]{color=red}"));
});

test("5.1 Content: in a table cell a | inside a span is written \\|", () => {
  assert.equal(
    html("| a |\n|---|\n| [x \\| y]{color=red} |"),
    "<table>\n<thead>\n<tr>\n<th>a</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>" + span(RED, "x | y") + "</td>\n</tr>\n</tbody>\n</table>\n",
  );
});

test("5.1 Examples: the six example spans", () => {
  assert.equal(html("[flight is delayed]{color=red}"), p(span(RED, "flight is delayed")));
  assert.equal(html("[window seat]{bg=mint}"), p(span("background-color: var(--note-mint)", "window seat")));
  assert.equal(html('[a postcard line]{font="Caveat"}'), p(span("font-family: 'Caveat'", "a postcard line")));
  assert.equal(html("[small print]{size=small}"), p(span("font-size: 0.875em", "small print")));
  assert.equal(html("[C++]{underline=yes}"), p(span("text-decoration: underline", "C++")));
  assert.equal(
    html('[**Do not forget the passport**]{color=white bg=red font="Inter" size=large underline=yes}'),
    p(
      span(
        "color: var(--note-white); background-color: var(--note-red); font-family: 'Inter'; font-size: 1.25em; text-decoration: underline",
        "<strong>Do not forget the passport</strong>",
      ),
    ),
  );
});

test("5.1 Examples: side-by-side spans for a differently styled word", () => {
  assert.equal(
    html('[The title is ]{font="Georgia"}[Saudade]{font="Georgia" color=red}[, in two colours.]{font="Georgia"}'),
    p(
      span("font-family: 'Georgia'", "The title is ") +
        span("color: var(--note-red); font-family: 'Georgia'", "Saudade") +
        span("font-family: 'Georgia'", ", in two colours."),
    ),
  );
});

test("5.1 source ranges: a span, its attribute list and its content carry source offsets", () => {
  const note = parseNote("ab [cd]{color=red} e");
  const para = note.children[0];
  assert.ok(para.type === "paragraph");
  const s = para.children[1];
  assert.ok(s.type === "span");
  assert.deepEqual(s.range, { start: 3, end: 18 });
  assert.deepEqual(s.attributes.range, { start: 7, end: 18 });
  assert.deepEqual(s.attributes.attributes, [{ key: "color", value: "red", quoted: false, range: { start: 8, end: 17 } }]);
  assert.deepEqual(s.children, [{ type: "text", value: "cd", range: { start: 4, end: 6 } }]);
});

test("5.1 scan pass: an escaped [ is not pushed and an escaped ] closes nothing", () => {
  assert.equal(html("[a \\] b]{color=red}"), p(span(RED, "a ] b")));
  assert.equal(html("\\[a]{color=red}"), p("[a]{color=red}"));
  assert.equal(html("[a [b\\] c]{color=red}"), p("[a " + span(RED, "b] c")));
});
