// SPEC 5.3 Attribute list: syntax, validity, colour, font and size values.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAttributeList, resolveAttributes } from "../src/index.ts";
import { html, p, span } from "./helpers.ts";

const RED = "color: var(--note-red)";

test("5.3 syntax: {, optional spaces, attributes separated by one or more spaces, optional spaces, }", () => {
  assert.equal(html("[x]{ color=red   bg=blue }"), p(span(RED + "; background-color: var(--note-blue)", "x")));
  assert.equal(html("[x]{color=red bg=blue}"), p(span(RED + "; background-color: var(--note-blue)", "x")));
});

test("5.3 syntax: a space is U+0020 only; a tab is not a space", () => {
  assert.equal(html("[x]{color=red\tbg=blue}"), p("[x]{color=red\tbg=blue}"));
  assert.equal(html("[x]{\tcolor=red}"), p("[x]{\tcolor=red}"));
});

test("5.3 syntax: attributes must be separated by at least one space", () => {
  assert.equal(parseAttributeList('{font="a"color=red}', 0), null);
});

test("5.3 syntax: the list ends at the first } that is not inside a quoted string", () => {
  assert.equal(html('[x]{font="a}b"}'), p(span("font-family: 'a}b'", "x")));
  const list = parseAttributeList('{font="a}b"} rest', 0);
  assert.ok(list);
  assert.equal(list.end, 12);
});

test("5.3 syntax: an attribute list is written on one line", () => {
  assert.equal(html("[x]{color=red\nbg=blue}"), p("[x]{color=red\nbg=blue}"));
  assert.equal(html('[x]{font="a\nb"}'), p('[x]{font=&quot;a\nb&quot;}'));
});

test("5.3 syntax: key=value with nothing between key, = and value", () => {
  assert.equal(html("[x]{color= red}"), p("[x]{color= red}"));
  assert.equal(html("[x]{color =red}"), p("[x]{color =red}"));
});

test("5.3 syntax: a key is one or more lower-case ASCII letters", () => {
  assert.equal(html("[x]{Color=red}"), p("[x]{Color=red}"));
  assert.equal(html("[x]{col1=red}"), p("[x]{col1=red}"));
  assert.equal(html("[x]{=red}"), p("[x]{=red}"));
});

test("5.3 syntax: a bare word is ASCII letters, digits, #, %, ., - or _", () => {
  const list = parseAttributeList("{a=Az09#%.-_}", 0);
  assert.ok(list);
  assert.equal(list.attributes[0].value, "Az09#%.-_");
  assert.equal(parseAttributeList("{a=b/c}", 0), null);
});

test("5.3 syntax: a quoted string, with \\\" and \\\\ escapes and other backslashes literal", () => {
  const list = parseAttributeList('{font="a\\"b\\\\c\\d e"}', 0);
  assert.ok(list);
  assert.deepEqual(
    list.attributes.map((a) => [a.key, a.value, a.quoted]),
    [["font", 'a"b\\c\\d e', true]],
  );
});

test("5.3 syntax: spaces inside a quoted string do not separate attributes", () => {
  assert.equal(html('[x]{font="IBM Plex Serif" color=red}'), p(span(RED + "; font-family: 'IBM Plex Serif'", "x")));
});

test("5.3 syntax: validation uses the quoted value, for every key: color=\"red\" means color=red", () => {
  assert.equal(html('[x]{color="red"}'), html("[x]{color=red}"));
  assert.equal(html('[x]{size="large" underline="yes"}'), p(span("font-size: 1.25em; text-decoration: underline", "x")));
});

test("5.3 syntax: CommonMark backslash escapes do not apply inside an attribute list", () => {
  assert.equal(html("[x]{color=r\\ed}"), p("[x]{color=r\\ed}"));
  assert.equal(html('[x]{font="a\\*b"}'), p(span("font-family: 'a\\\\*b'", "x")));
});

test("5.3 not attribute lists: {color = red}, {font=IBM Plex Serif}, {font=Café}, {font=\"a\\\"}", () => {
  assert.equal(html("[x]{color = red}"), p("[x]{color = red}"));
  assert.equal(html("[x]{font=IBM Plex Serif}"), p("[x]{font=IBM Plex Serif}"));
  assert.equal(html("[x]{font=Café}"), p("[x]{font=Café}"));
  assert.equal(parseAttributeList('{font="a\\"}', 0), null);
  assert.equal(html('[x]{font="a\\"}'), p('[x]{font=&quot;a&quot;}'));
});

test("5.3 syntax decides recognition: [x]{color=redd} is a span that shows a plain x", () => {
  assert.equal(html("[x]{color=redd}"), p("<span>x</span>"));
  assert.equal(html("[x]{foo=bar}"), p("<span>x</span>"));
});

test("5.3 table: width is allowed on images only; on a span it is ignored", () => {
  assert.equal(html("[x]{width=50%}"), p("<span>x</span>"));
  assert.deepEqual(resolveAttributes([{ key: "width", value: "50%" }], "image"), { width: "50%" });
  assert.deepEqual(resolveAttributes([{ key: "color", value: "red" }], "image"), {});
});

test("5.3 table: color, bg, font, size and underline are allowed on spans, paragraphs and headings", () => {
  const attrs = [
    { key: "color", value: "red" },
    { key: "bg", value: "mint" },
    { key: "font", value: "serif" },
    { key: "size", value: "xl" },
    { key: "underline", value: "no" },
  ];
  const all = { color: "red", bg: "mint", font: "serif", size: "xl", underline: "no" };
  for (const place of ["span", "paragraph", "heading"] as const) assert.deepEqual(resolveAttributes(attrs, place), all);
});

test("5.3 an unknown key or an invalid value is ignored; the other attributes still apply", () => {
  assert.equal(html("[x]{foo=1 color=red bg=nope}"), p(span(RED, "x")));
});

test("5.3 a repeated key: only its last occurrence counts; if that one is invalid the key is ignored", () => {
  assert.equal(html("[x]{color=blue color=red}"), p(span(RED, "x")));
  assert.equal(html("[x]{color=red color=bluee}"), p("<span>x</span>"));
});

test("5.3 matching without regard to case: palette names, highlight, generic fonts, sizes, yes, no, hex digits", () => {
  assert.equal(
    html("[x]{color=RED bg=HighLight font=MONO size=LARGE underline=YES}"),
    p(span("color: var(--note-red); background-color: var(--note-highlight); font-family: var(--note-font-mono); font-size: 1.25em; text-decoration: underline", "x")),
  );
  assert.equal(html("[x]{underline=No}"), p(span("text-decoration: none", "x")));
  assert.equal(html("[x]{color=#ABCDEF}"), p(span("color: #ABCDEF", "x")));
});

test("5.3 colour value: every palette name", () => {
  for (const name of ["red", "orange", "yellow", "green", "mint", "teal", "blue", "indigo", "purple", "pink", "brown", "gray", "black", "white"]) {
    assert.equal(html(`[x]{color=${name}}`), p(span(`color: var(--note-${name})`, "x")));
  }
  assert.equal(html("[x]{color=grey}"), p("<span>x</span>"));
});

test("5.3 colour value: #rgb or #rrggbb, used exactly as written, case included", () => {
  assert.equal(html("[x]{color=#2b6cb0}"), p(span("color: #2b6cb0", "x")));
  assert.equal(html("[x]{bg=#Abc}"), p(span("background-color: #Abc", "x")));
  assert.equal(html("[x]{color=#ABCDEF}"), p(span("color: #ABCDEF", "x")));
  assert.equal(html("Para\n{bg=#A1B2C3}"), '<p style="background-color: #A1B2C3">Para</p>\n');
  for (const bad of ["#abcd", "#ab", "#abcdeg", "2b6cb0"]) assert.equal(html(`[x]{color=${bad}}`), p("<span>x</span>"));
});

test("5.3 colour value: highlight is allowed for bg only", () => {
  assert.equal(html("[x]{bg=highlight}"), p(span("background-color: var(--note-highlight)", "x")));
  assert.equal(html("[x]{color=highlight}"), p("<span>x</span>"));
});

test("5.3 font value: a family name, or the generic names serif, sans and mono", () => {
  assert.equal(html("[x]{font=Georgia}"), p(span("font-family: 'Georgia'", "x")));
  assert.equal(html('[x]{font="IBM Plex Serif"}'), p(span("font-family: 'IBM Plex Serif'", "x")));
  assert.equal(html("[x]{font=serif}"), p(span("font-family: var(--note-font-serif)", "x")));
  assert.equal(html("[x]{font=Sans}"), p(span("font-family: var(--note-font-sans)", "x")));
  assert.equal(html("[x]{font=mono}"), p(span("font-family: var(--note-font-mono)", "x")));
});

test("5.3 font value: a name that is not a bare word must be quoted", () => {
  assert.equal(html("[x]{font=Source Serif}"), p("[x]{font=Source Serif}"));
  assert.equal(html("[x]{font=\"O'Neil Sans\"}"), p(span("font-family: 'O\\'Neil Sans'", "x")));
});

test("5.3 size value: named sizes multiply the size the text would have had", () => {
  const sizes: [string, string][] = [["xs", "0.75em"], ["small", "0.875em"], ["normal", "1em"], ["large", "1.25em"], ["xl", "1.5em"], ["xxl", "2em"]];
  for (const [name, css] of sizes) assert.equal(html(`[x]{size=${name}}`), p(span(`font-size: ${css}`, "x")));
});

test("5.3 size value: on a span in a heading the base is the heading's size (em of the heading)", () => {
  assert.equal(html("# Big [x]{size=large}"), '<h1>Big <span style="font-size: 1.25em">x</span></h1>\n');
});

test("5.3 size value: in a paragraph with {size=small}, [x]{size=large} is 0.875 × 1.25 of the body size", () => {
  // The paragraph is 0.875em of the body; the span is 1.25em of the paragraph.
  assert.equal(html("A [x]{size=large}\n{size=small}"), '<p style="font-size: 0.875em">A <span style="font-size: 1.25em">x</span></p>\n');
});

test("5.3 size value: on a heading's block attribute line the base is the heading's own size", () => {
  assert.equal(html("## H\n{size=large}"), '<h2 style="font-size: calc(var(--note-h2-size, 1.5em) * 1.25)">H</h2>\n');
  assert.equal(html("# H\n{size=xs}"), '<h1 style="font-size: calc(var(--note-h1-size, 2em) * 0.75)">H</h1>\n');
});

test("5.3 size value: pixels from 6 to 200 are absolute and used as written", () => {
  assert.equal(html("[a]{size=5px} [b]{size=6px} [c]{size=200px} [d]{size=201px} [e]{size=22.5px} [f]{size=22PX}"),
    p('<span>a</span> <span style="font-size: 6px">b</span> <span style="font-size: 200px">c</span> <span>d</span> <span>e</span> <span>f</span>'));
});

test("5.3 width value: 1% to 100% or 16px to 4000px, whole numbers", () => {
  const ok = ["1%", "100%", "16px", "4000px"];
  const bad = ["0%", "101%", "15px", "4001px", "50.5%", "50", "50PX"];
  for (const v of ok) assert.deepEqual(resolveAttributes([{ key: "width", value: v }], "image"), { width: v });
  for (const v of bad) assert.deepEqual(resolveAttributes([{ key: "width", value: v }], "image"), {});
});

test("5.3 underline value: yes or no", () => {
  assert.equal(html("[x]{underline=yes}"), p(span("text-decoration: underline", "x")));
  assert.equal(html("[x]{underline=no}"), p(span("text-decoration: none", "x")));
  assert.equal(html("[x]{underline=true}"), p("<span>x</span>"));
});
