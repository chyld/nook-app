// SPEC-AGENTS 9, core: front matter put before a body; `nook` added to a drawing; a note taken as
// head and text for an append; the comparisons of 3.3.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNote } from "../../../noteformat/src/index.ts";
import { appendToNote, droppedImage, drawingFacts, hasBrokenFrontMatter, hasFrontMatter, liveElements, newNoteText, noteIsBlank, noteTitle, splitNote, withFrontMatter, withNook } from "../src/index.ts";

const fields = (text: string) => parseNote(text).frontMatter?.fields ?? {};

test("front matter before a body: title, tags and created, each read back by the format", () => {
  const t = withFrontMatter("- oats\n", "Shopping", ["food", "home"], "2026-11-12");
  assert.equal(t, '---\ntitle: "Shopping"\ntags: [food, home]\ncreated: 2026-11-12\n---\n\n- oats\n');
  assert.equal(hasBrokenFrontMatter(t), false);
  assert.deepEqual(fields(t).tags, ["food", "home"]);
  assert.equal(fields(t).created, "2026-11-12");
  assert.equal(noteTitle(t), "Shopping");
});

test("front matter before a body: without a title none is written, and the first heading is the title", () => {
  const t = withFrontMatter("# Plans\n\ntext\n", null, [], "2026-11-12");
  assert.equal(t, "---\ncreated: 2026-11-12\n---\n\n# Plans\n\ntext\n");
  assert.equal(noteTitle(t), "Plans");
  assert.equal(withFrontMatter("x", null, ["a"], "2026-11-12"), "---\ntags: [a]\ncreated: 2026-11-12\n---\n\nx");
});

test("front matter before a body: a title with a quote and a backslash is quoted as a new note's is", () => {
  const title = 'Say "hi" \\ bye';
  const t = withFrontMatter("", title, [], "2026-11-12");
  assert.equal(t, newNoteText(title, "2026-11-12"), "an empty body gives exactly a new note's text");
  assert.equal(noteTitle(t), title);
});

test("front matter before a body: the body's line endings are used, and a byte order mark is dropped", () => {
  const crlf = withFrontMatter("one\r\ntwo\r\n", "T", [], "2026-11-12");
  assert.equal(crlf, '---\r\ntitle: "T"\r\ncreated: 2026-11-12\r\n---\r\n\r\none\r\ntwo\r\n');
  assert.equal(/[^\r]\n/.test(crlf), false, "no bare LF");
  const bom = withFrontMatter("﻿body\n", "T", [], "2026-11-12");
  assert.equal(bom.includes("﻿"), false);
  assert.equal(bom.endsWith("\n\nbody\n"), true);
});

test("has front matter: only what the format reads as front matter", () => {
  assert.equal(hasFrontMatter('---\ntitle: "T"\n---\n\ntext\n'), true);
  assert.equal(hasFrontMatter('﻿---\ntitle: "T"\n---\n'), true, "after a byte order mark");
  assert.equal(hasFrontMatter("text\n"), false);
  assert.equal(hasFrontMatter(""), false);
  assert.equal(hasFrontMatter("---\n\nA rule, then text, and no closing line.\n"), false);
});

test("nook added to a drawing: the last key, the other keys and their order kept", () => {
  const doc = { type: "excalidraw", zebra: 1, elements: [{ id: "a", isDeleted: true }], appState: { zoom: 2 }, files: { f: { id: "f" } }, apple: [1] };
  const out = withNook(doc, { title: "Plan", tags: ["work"], created: "2026-11-12" });
  const back = JSON.parse(out) as Record<string, unknown>;
  assert.deepEqual(Object.keys(back), ["type", "zebra", "elements", "appState", "files", "apple", "nook"]);
  assert.deepEqual(back.nook, { title: "Plan", tags: ["work"], created: "2026-11-12" });
  assert.deepEqual({ ...back, nook: undefined }, { ...doc, nook: undefined }, "nothing else is changed: deleted elements, the view and unused files stay");
  assert.equal(out.endsWith("}\n"), true);
  assert.equal(out, JSON.stringify(back, null, 2) + "\n", "two-space indent and a final line break");
  const facts = drawingFacts(out);
  assert.equal(facts.title, "Plan");
  assert.deepEqual(facts.tags, ["work"]);
});

test("a note as head and text: front matter through its closing line's line ending", () => {
  assert.deepEqual(splitNote('---\ntitle: "T"\n---\n\nbody\n'), { head: '---\ntitle: "T"\n---\n', text: "\nbody\n" });
  assert.deepEqual(splitNote("just text\n"), { head: "", text: "just text\n" });
  assert.deepEqual(splitNote("﻿text"), { head: "﻿", text: "text" });
  assert.deepEqual(splitNote('﻿---\ntitle: "T"\n---\nx'), { head: '﻿---\ntitle: "T"\n---\n', text: "x" });
  assert.deepEqual(splitNote(""), { head: "", text: "" });
});

test("append: exactly one empty line between what was there and what was added", () => {
  const head = '---\ntitle: "T"\n---\n';
  assert.equal(appendToNote(head + "\none\n", "two"), head + "\none\n\ntwo\n");
  assert.equal(appendToNote(head + "\none", "two\n"), head + "\none\n\ntwo\n", "a note with no final line break");
  assert.equal(appendToNote(head + "\none\n\n\n\n", "two"), head + "\none\n\ntwo\n", "a note ending in empty lines");
  assert.equal(appendToNote(head + "\none  \t\n", "two"), head + "\none\n\ntwo\n", "trailing spaces and tabs go");
  assert.equal(appendToNote("one\n", "\n\ntwo\n\n\n"), "one\n\ntwo\n", "the body's own empty lines at its start and end go");
  assert.equal(appendToNote("one\n", "a\n\nb"), "one\n\na\n\nb\n", "the middle of the body is kept");
});

test("append: a note that is only front matter keeps its front matter", () => {
  for (const note of [newNoteText("T", "2026-11-12"), '---\ntitle: "T"\ncreated: 2026-11-12\n---\n', '---\ntitle: "T"\ncreated: 2026-11-12\n---']) {
    const out = appendToNote(note, "hello")!;
    assert.equal(out, '---\ntitle: "T"\ncreated: 2026-11-12\n---\nhello\n', JSON.stringify(note));
    assert.equal(noteTitle(out), "T");
    assert.equal(fields(out).created, "2026-11-12");
    assert.equal(hasBrokenFrontMatter(out), false);
    assert.equal(splitNote(out).text, "hello\n");
  }
});

test("append: an empty note, a byte order mark, and a kept space", () => {
  assert.equal(appendToNote("", "hello"), "hello\n");
  assert.equal(appendToNote("\n\n", "hello"), "hello\n");
  assert.equal(appendToNote("﻿one\n", "﻿two"), "﻿one\n\ntwo\n", "the note's mark stays, the body's goes");
  assert.equal(appendToNote("﻿", "x"), "﻿x\n");
  assert.equal(appendToNote("one \n", "two"), "one \n\ntwo\n", "a kept space (U+00A0) at the end of the note is not removed");
});

test("append: the note's line endings are used for the added text", () => {
  assert.equal(appendToNote("one\r\ntwo\r\n", "a\nb"), "one\r\ntwo\r\n\r\na\r\nb\r\n");
  assert.equal(appendToNote("one\ntwo\n", "a\r\nb\r\n"), "one\ntwo\n\na\nb\n");
  assert.equal(appendToNote("no line ending", "a\r\nb"), "no line ending\n\na\nb\n", "LF when the note has none");
  assert.equal(appendToNote('---\r\ntitle: "T"\r\n---\r\n', "x"), '---\r\ntitle: "T"\r\n---\r\nx\r\n');
});

test("append: nothing to add", () => {
  assert.equal(appendToNote("one\n", ""), null);
  assert.equal(appendToNote("one\n", " \n\t\r\n"), null);
});

test("3.3: a note is blank when nothing but white space follows its head", () => {
  assert.equal(noteIsBlank(newNoteText("T", "2026-11-12")), true);
  assert.equal(noteIsBlank("  \n\n"), true);
  assert.equal(noteIsBlank(""), true);
  assert.equal(noteIsBlank('---\ntitle: "T"\n---\n\nx\n'), false);
  assert.equal(noteIsBlank("x"), false);
});

test("3.3: live elements are the objects not marked deleted", () => {
  assert.equal(liveElements({ elements: [{ id: "a" }, { id: "b", isDeleted: true }, { id: "c", isDeleted: false }, null, 3, "x"] }).length, 2);
  assert.equal(liveElements({ elements: [{ id: "b", isDeleted: true }] }).length, 0);
  assert.equal(liveElements({}).length, 0);
  assert.equal(liveElements({ elements: "no" }).length, 0);
});

test("3.3: a dropped image is one a live element uses, the new files lack and the current file has", () => {
  const img = (id: string, fileId: string, isDeleted = false) => ({ type: "image", id, fileId, isDeleted });
  const current = { elements: [img("a", "f1"), img("b", "f2")], files: { f1: { id: "f1" }, f2: { id: "f2" } } };
  assert.equal(droppedImage({ elements: [img("a", "f1"), img("b", "f2")], files: { f1: {}, f2: {} } }, current), null);
  assert.equal(droppedImage({ elements: [img("a", "f1"), img("b", "f2")], files: { f1: {} } }, current), "f2");
  assert.equal(droppedImage({ elements: [img("a", "f1"), img("b", "f2")] }, current), "f1", "no files at all");
  assert.equal(droppedImage({ elements: [img("a", "f1"), img("b", "f2", true)], files: { f1: {} } }, current), null, "a deleted element's image may go");
  assert.equal(droppedImage({ elements: [img("a", "f1")], files: { f1: {} } }, current), null, "an image no element uses may go");
  assert.equal(droppedImage({ elements: [img("a", "f9")], files: {} }, current), null, "an image the current file never had is not dropped by this save");
  assert.equal(droppedImage({ elements: [img("a", "constructor")], files: {} }, { elements: [], files: {} }), null, "not a name every object has");
});
