// SPEC 5.4 Block attribute line.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNote } from "../src/index.ts";
import { html, p, span } from "./helpers.ts";

const RED = 'style="color: var(--note-red)"';

test("5.4 condition 1: an attribute list and nothing else except optional spaces around it", () => {
  assert.equal(html("Para\n   {color=red}  "), `<p ${RED}>Para</p>\n`);
  assert.equal(html("Para\n{color=red} x"), p("Para\n{color=red} x"));
  assert.equal(html("Para\n{color=red}\t"), p("Para\n{color=red}"));
  assert.equal(html("Para\n{color = red}"), p("Para\n{color = red}"));
});

test("5.4 condition 2: the line after it is blank, or it is the last line of the file", () => {
  assert.equal(html("Para\n{color=red}\n\nNext"), `<p ${RED}>Para</p>\n` + p("Next"));
  assert.equal(html("Para\n{color=red}\n   \nNext"), `<p ${RED}>Para</p>\n` + p("Next"));
  assert.equal(html("Para\n{color=red}"), `<p ${RED}>Para</p>\n`);
  assert.equal(html("Para\n{color=red}\n"), `<p ${RED}>Para</p>\n`);
  assert.equal(html("Para\n{color=red}\n# H"), p("Para\n{color=red}") + "<h1>H</h1>\n");
});

test("5.4 condition 3: the line before it is not blank", () => {
  assert.equal(html("Para\n\n{color=red}"), p("Para") + p("{color=red}"));
});

test("5.4 condition 4: at least one key allowed for the block; {a=1 b=2} under a paragraph stays visible", () => {
  assert.equal(html("Para\n{a=1 b=2}"), p("Para\n{a=1 b=2}"));
  assert.equal(html("Para\n{width=50%}"), p("Para\n{width=50%}"));
  assert.equal(html("# H\n{width=50%}"), "<h1>H</h1>\n" + p("{width=50%}"));
});

test("5.4 condition 4: an allowed key with an invalid value still makes a block attribute line", () => {
  assert.equal(html("Para\n{color=redd}"), p("Para"));
  assert.equal(html("Para\n{color=redd bg=blue}"), '<p style="background-color: var(--note-blue)">Para</p>\n');
});

test("5.4 case Heading: the line before is an ATX heading that is a direct child of the document", () => {
  assert.equal(html("# A red heading\n{color=red}"), `<h1 ${RED}>A red heading</h1>\n`);
  assert.equal(html("### H ###\n{bg=mint}"), '<h3 style="background-color: var(--note-mint)">H</h3>\n');
  assert.equal(html("> # H\n{color=red}"), "<blockquote>\n<h1>H</h1>\n</blockquote>\n" + p("{color=red}"));
  assert.equal(html("- # H\n{color=red}"), "<ul>\n<li>\n<h1>H</h1>\n</li>\n</ul>\n" + p("{color=red}"));
});

test("5.4 case Image: the rest of the paragraph is exactly one image; only width is allowed", () => {
  assert.equal(html("![Tram](tram.jpg)\n{width=70%}"), p('<img src="tram.jpg" alt="Tram" style="width: 70%">'));
  assert.equal(html("![Tram](tram.jpg)\n{width=300px}"), p('<img src="tram.jpg" alt="Tram" style="width: 300px">'));
  assert.equal(html("![Tram](tram.jpg)\n{width=500}"), p('<img src="tram.jpg" alt="Tram">'));
  assert.equal(html("![Tram](tram.jpg)\n{color=red}"), p('<img src="tram.jpg" alt="Tram">\n{color=red}'));
});

test("5.4 case Image: an image with other text is the Paragraph case", () => {
  assert.equal(html("![Tram](tram.jpg) text\n{color=red}"), `<p ${RED}><img src="tram.jpg" alt="Tram"> text</p>\n`);
  assert.equal(html("![Tram](tram.jpg) text\n{width=50%}"), p('<img src="tram.jpg" alt="Tram"> text\n{width=50%}'));
});

test("5.4 case Image: the image may be on several lines and may be a reference", () => {
  assert.equal(html("![Tram][t]\n{width=50%}\n\n[t]: tram.jpg"), p('<img src="tram.jpg" alt="Tram" style="width: 50%">'));
});

test("5.4 case Paragraph: the last line, and not the only line, of a paragraph that is a direct child", () => {
  assert.equal(html("Line one\nLine two\n{color=red}"), `<p ${RED}>Line one\nLine two</p>\n`);
  assert.equal(html("{color=red}"), p("{color=red}"));
});

test("5.4 every other position: inside or directly under a list item or block quote it is a continuation", () => {
  assert.equal(html("- item\n{color=red}"), "<ul>\n<li>item\n{color=red}</li>\n</ul>\n");
  assert.equal(html("- item\n  {color=red}"), "<ul>\n<li>item\n{color=red}</li>\n</ul>\n");
  assert.equal(html("> quote\n{color=red}"), "<blockquote>\n" + p("quote\n{color=red}") + "</blockquote>\n");
  assert.equal(html("> quote\n> {color=red}"), "<blockquote>\n" + p("quote\n{color=red}") + "</blockquote>\n");
});

test("5.4 every other position: directly under a table it is a table row", () => {
  assert.equal(html("| a |\n|---|\n{color=red}"), "<table>\n<thead>\n<tr>\n<th>a</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>{color=red}</td>\n</tr>\n</tbody>\n</table>\n");
});

test("5.4 every other position: under a setext heading, a code block or a horizontal rule it is a paragraph", () => {
  assert.equal(html("Title\n===\n{color=red}"), "<h1>Title</h1>\n" + p("{color=red}"));
  assert.equal(html("```\ncode\n```\n{color=red}"), "<pre><code>code\n</code></pre>\n" + p("{color=red}"));
  assert.equal(html("    code\n{color=red}"), "<pre><code>code\n</code></pre>\n" + p("{color=red}"));
  assert.equal(html("---\n{color=red}"), "<hr>\n" + p("{color=red}"));
});

test("5.4 every other position: a line with a blank line above it, or in the middle of a paragraph", () => {
  assert.equal(html("Para\n\n{color=red}"), p("Para") + p("{color=red}"));
  assert.equal(html("Line one\n{color=red}\nLine three"), p("Line one\n{color=red}\nLine three"));
});

test("5.4 an attribute list that is not part of a span or a block attribute line is literal text", () => {
  assert.equal(html("text {color=red} text"), p("text {color=red} text"));
});

test("5.4 a block attribute line is not shown and is not part of the text of its block", () => {
  const note = parseNote("Para\n{color=red}");
  const para = note.children[0];
  assert.ok(para.type === "paragraph");
  assert.deepEqual(para.children, [{ type: "text", value: "Para", range: { start: 0, end: 4 } }]);
  assert.ok(para.attributes);
  assert.equal(para.attributes.target, "paragraph");
  assert.deepEqual(para.attributes.range, { start: 5, end: 16 });
  assert.deepEqual(para.attributes.list.attributes, [{ key: "color", value: "red", quoted: false, range: { start: 6, end: 15 } }]);
  assert.deepEqual(para.contentRange, { start: 0, end: 4 });
});

test("5.4 the heading case attaches the line to the heading and removes it from the document", () => {
  const note = parseNote("# H\n{color=red}\n\nText");
  assert.equal(note.children.length, 2);
  const h = note.children[0];
  assert.ok(h.type === "heading");
  assert.equal(h.attributes?.target, "heading");
  assert.deepEqual(h.attributes?.range, { start: 4, end: 15 });
});

test("5.4 styled spans may be used inside a block that has a block attribute line", () => {
  assert.equal(html("A [b]{color=red} c\n{bg=mint}"), '<p style="background-color: var(--note-mint)">A ' + span("color: var(--note-red)", "b") + " c</p>\n");
});

test("5.4 the trailing spaces of the line before are not a hard line break", () => {
  assert.equal(html("Para  \n{color=red}"), `<p ${RED}>Para</p>\n`);
});

test("5.4 Examples: the three examples", () => {
  assert.equal(
    html("This whole paragraph is grey and small.\n{color=gray size=small}"),
    '<p style="color: var(--note-gray); font-size: 0.875em">This whole paragraph is grey and small.</p>\n',
  );
  assert.equal(html("# A red heading\n{color=red}"), `<h1 ${RED}>A red heading</h1>\n`);
  assert.equal(
    html("![Tram 28 at dusk](<Lisbon trip.assets/tram.jpg>)\n{width=70%}"),
    p('<img src="Lisbon%20trip.assets/tram.jpg" alt="Tram 28 at dusk" style="width: 70%">'),
  );
});

test("5.4 a heading's block attribute line holds every style key, in the fixed order", () => {
  assert.equal(
    html('# H\n{underline=yes size=xl font="Inter" bg=yellow color=blue}'),
    '<h1 style="color: var(--note-blue); background-color: var(--note-yellow); font-family: \'Inter\'; font-size: calc(var(--note-h1-size, 2em) * 1.5); text-decoration: underline">H</h1>\n',
  );
});

test("5.4 CRLF line endings: the rules about a line's content are the same", () => {
  assert.equal(html("Para\r\n{color=red}\r\n\r\nNext\r\n"), `<p ${RED}>Para</p>\n` + p("Next"));
});
