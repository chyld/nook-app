// SPEC 3 Front matter.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNote, renderNote } from "../src/index.ts";
import { html, p } from "./helpers.ts";

const fields = (src: string) => parseNote(src).frontMatter?.fields ?? null;
const meta = (src: string, fileName?: string) => renderNote(src, { fileName }).meta;

test("3 condition 1: the first line of the file is ---, optionally followed by spaces", () => {
  assert.deepEqual(fields("---   \ntitle: A\n---\nbody"), { title: "A" });
  assert.equal(fields("\n---\ntitle: A\n---\nbody"), null);
  assert.equal(fields("--- x\ntitle: A\n---\nbody"), null);
  assert.equal(fields("---\t\ntitle: A\n---\nbody"), null);
});

test("3 condition 2: a later line is ---, optionally followed by spaces; the first such line closes", () => {
  assert.deepEqual(fields("---\ntitle: A\n---  \nbody"), { title: "A" });
  assert.equal(fields("---\ntitle: A\nbody"), null);
  const note = parseNote("---\ntitle: A\n---\nx: 1\n---\nbody");
  assert.deepEqual(note.frontMatter?.fields, { title: "A" });
  assert.equal(renderNote("---\ntitle: A\n---\nx: 1\n---\nbody").html, "<h2>x: 1</h2>\n" + p("body"));
});

test("3 condition 3: the lines between are a YAML mapping with at least one key", () => {
  assert.equal(fields("---\njust text\n---\nbody"), null);
  assert.equal(fields("---\n- a\n- b\n---\nbody"), null);
  assert.equal(fields("---\n---\nbody"), null);
  assert.equal(fields("---\n# only a comment\n---\nbody"), null);
  assert.equal(fields("---\n{}\n---\nbody"), null);
  assert.deepEqual(fields("---\n{title: Flow}\n---\nbody"), { title: "Flow" });
});

test("3 condition 3: YAML nested deeper than the reader's limit is not front matter", () => {
  assert.equal(fields("---\nt: " + "[".repeat(15000) + "]".repeat(15000) + "\n---\nbody"), null);
  const deep = Array.from({ length: 3000 }, (_, i) => " ".repeat(i) + "a:").join("\n");
  assert.equal(fields("---\n" + deep + "\n---\nbody"), null);
  assert.deepEqual(fields("---\ntitle: T\nt: " + "[".repeat(20) + "]".repeat(20) + "\n---\nbody"), { title: "T" });
});

test("3 condition 3: text that is not valid YAML is not front matter", () => {
  assert.equal(fields("---\ntitle: a: b\n---\nbody"), null);
  assert.equal(fields("---\ntitle: [a\n---\nbody"), null);
  assert.equal(fields("---\n\ttitle: tab\n---\nbody"), null);
  assert.equal(fields("---\ntitle: a\n  - b\n c: d\n---\nbody"), null);
});

test("3 condition 3: a key that appears more than once is allowed, and its last occurrence is used", () => {
  assert.deepEqual(fields("---\ntitle: first\ntitle: second\n---\n"), { title: "second" });
  assert.deepEqual(fields("---\ntitle: good\ntitle: [bad]\n---\n"), {});
});

test("3 if a condition fails, the whole file is the body", () => {
  const src = "---\nnot: [closed\n---\ntext";
  const note = parseNote(src);
  assert.equal(note.frontMatter, null);
  assert.deepEqual(note.bodyRange, { start: 0, end: src.length });
  assert.equal(html(src), "<hr>\n" + "<h2>not: [closed</h2>\n" + p("text"));
});

test("3 a note that begins with a horizontal rule is read as body text", () => {
  assert.equal(html("---\n\nSome text\n\n---\n"), "<hr>\n" + p("Some text") + "<hr>\n");
  assert.equal(parseNote("---\n\nSome text\n\n---\n").frontMatter, null);
});

test("3 ...unless what follows the rule happens to be a YAML mapping closed by another ---", () => {
  const note = parseNote("---\nkey: value\n---\nText");
  assert.ok(note.frontMatter);
  assert.equal(html("---\nkey: value\n---\nText"), p("Text"));
});

test("3 front matter ranges: the block and its content", () => {
  const src = "---\ntitle: A\n---\nbody";
  const fm = parseNote(src).frontMatter;
  assert.ok(fm);
  assert.deepEqual(fm.range, { start: 0, end: 17 });
  assert.equal(src.slice(fm.range.start, fm.range.end), "---\ntitle: A\n---\n");
  assert.deepEqual(fm.contentRange, { start: 4, end: 12 });
  assert.deepEqual(parseNote(src).bodyRange, { start: 17, end: 21 });
});

test("3 title: a scalar, shown for the note", () => {
  assert.equal(meta("---\ntitle: Lisbon trip\n---\n# Other").title, "Lisbon trip");
  assert.equal(meta("---\ntitle: [a, b]\n---\n# Heading").title, "Heading");
});

test("3 title default: the text of the first level-1 heading, then the file name", () => {
  assert.equal(meta("## Two\n\n# One *big*\n\n# Later", "x.md").title, "One big");
  assert.equal(meta("Title\n=====", "x.md").title, "Title");
  assert.equal(meta("## Only two", "Lisbon trip.md").title, "Lisbon trip");
  assert.equal(meta("text", "notes/Lisbon trip.md").title, "Lisbon trip");
  assert.equal(meta("text").title, "");
});

test("3 tags: a list of scalars", () => {
  assert.deepEqual(meta("---\ntags: [travel, portugal]\n---\n").tags, ["travel", "portugal"]);
  assert.deepEqual(meta("---\ntags:\n  - travel\n  - 'old town'\n---\n").tags, ["travel", "old town"]);
  assert.deepEqual(meta("---\ntags: travel\n---\n").tags, []);
  assert.deepEqual(meta("---\ntags: [a, [b]]\n---\n").tags, []);
  // An empty scalar is not a value, so an empty tag is dropped.
  assert.deepEqual(meta('---\ntags: [a, "", b]\n---\n').tags, ["a", "b"]);
  assert.deepEqual(meta("---\ntags:\n  - a\n  -\n  - ''\n  - b\n---\n").tags, ["a", "b"]);
});

test("3 created and updated: an ISO 8601 date or date-time", () => {
  const m = meta("---\ncreated: 2026-11-10\nupdated: 2026-11-10T09:30:00Z\n---\n");
  assert.equal(m.created, "2026-11-10");
  assert.equal(m.updated, "2026-11-10T09:30:00Z");
  for (const ok of ["2026-02-28", "2024-02-29", "2026-11-10T09:30", "2026-11-10T09:30:00.123+02:00", "2026-11-10T09:30:00-0500"]) {
    assert.equal(meta(`---\ncreated: ${ok}\n---\n`).created, ok, ok);
  }
  for (const bad of ["2026-13-01", "2026-02-29", "2026-11-10 09:30", "10 Nov 2026", "2026-11-10T25:00", "yesterday"]) {
    assert.equal(meta(`---\ncreated: ${bad}\n---\n`).created, undefined, bad);
  }
});

test("3 created default: none; updated default: the file's modification time", () => {
  const m = renderNote("text", { modifiedTime: new Date("2026-11-09T08:00:00Z") }).meta;
  assert.equal(m.created, undefined);
  assert.equal(m.updated, "2026-11-09T08:00:00.000Z");
  assert.equal(renderNote("---\nupdated: 2026-11-10\n---\n", { modifiedTime: "2020-01-01" }).meta.updated, "2026-11-10");
});

test("3 font: a font value as in 5.3", () => {
  assert.equal(meta("---\nfont: Georgia\n---\n").font, "Georgia");
  assert.equal(meta("---\nfont: mono\n---\n").font, "mono");
});

test("3 size: a size value as in 5.3", () => {
  assert.equal(meta("---\nsize: 17px\n---\n").size, "17px");
  assert.equal(meta("---\nsize: large\n---\n").size, "large");
  assert.equal(meta("---\nsize: 17\n---\n").size, undefined);
  assert.equal(meta("---\nsize: 300px\n---\n").size, undefined);
});

test("3 theme: the name of the theme, kept as written", () => {
  assert.equal(meta("---\ntheme: paper\n---\n").theme, "paper");
  assert.equal(meta("---\ntheme: no-such-theme\n---\n").theme, "no-such-theme");
});

test("3 every key is optional", () => {
  assert.deepEqual(meta("---\nother: 1\n---\n# T"), { title: "T", tags: [] });
});

test("3 the value of a scalar is its text as written, without quotes; numbers and booleans are not converted", () => {
  assert.equal(meta("---\ntitle: true\n---\n").title, "true");
  assert.deepEqual(meta("---\ntags: [1.50, 007, null, ~, yes]\n---\n").tags, ["1.50", "007", "null", "~", "yes"]);
  assert.equal(meta("---\ntitle: '1.50'\n---\n").title, "1.50");
  assert.equal(meta('---\ntitle: "Quoted"\n---\n').title, "Quoted");
});

test("3 font and size are ordinary YAML strings: font: IBM Plex Serif and font: \"IBM Plex Serif\" mean the same", () => {
  assert.equal(meta("---\nfont: IBM Plex Serif\n---\n").font, "IBM Plex Serif");
  assert.equal(meta('---\nfont: "IBM Plex Serif"\n---\n').font, "IBM Plex Serif");
  assert.equal(meta('---\nsize: "17px"\n---\n').size, "17px");
});

test("3 unknown keys are kept unchanged (in the parsed mapping) and are otherwise ignored", () => {
  const note = parseNote("---\ntitle: T\nmood: sunny\nnested:\n  a: [1, 2]\n---\n");
  assert.ok(note.frontMatter);
  assert.deepEqual(
    note.frontMatter.mapping.entries.map((e) => e.key),
    ["title", "mood", "nested"],
  );
  assert.deepEqual(note.frontMatter.fields, { title: "T" });
  const src = "---\ntitle: T\nmood: sunny\n---\n";
  const fm = parseNote(src).frontMatter;
  assert.ok(fm);
  assert.equal(src.slice(fm.contentRange.start, fm.contentRange.end), "title: T\nmood: sunny");
});

test("3 a key with an invalid value is ignored and kept unchanged", () => {
  const note = parseNote("---\ntitle: [not, a, scalar]\nsize: huge\nfont: [x]\ncreated: soon\n---\n# H");
  assert.deepEqual(note.frontMatter?.fields, {});
  assert.equal(note.frontMatter?.mapping.entries.length, 4);
  assert.equal(renderNote("---\ntitle: [x]\n---\n# H").meta.title, "H");
});
