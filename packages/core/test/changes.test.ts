// Findings of the review of alpha's changes (CHANGES-REVIEW-FINDINGS.md) at the level of `core`:
// scenarios through `reduce`, as in scenarios.test.ts. Each test names its finding.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel, copySelection, type Intent, type Mode } from "../src/index.ts";
import { run } from "./scenario.ts";

const N = "\u00a0";

function out(marked: string, intent: Intent, mode: Mode = "rich"): string {
  const r = run(marked, intent, mode);
  assert.ok("out" in r, `${JSON.stringify(marked)} + ${JSON.stringify(intent)}: refused: ${"refused" in r ? r.refused : ""}`);
  return r.out;
}
function refused(marked: string, intent: Intent, mode: Mode = "rich"): string {
  const r = run(marked, intent, mode);
  assert.ok("refused" in r, `${JSON.stringify(marked)} + ${JSON.stringify(intent)}: expected a refusal, got ${"out" in r ? JSON.stringify(r.out) : ""}`);
  return r.refused;
}

const TABLE = "| a | b |\n|---|---|\n| c | d |";
const below: Intent = { type: "lineAfterTable" };

// --- 1. Lost or damaged text ---------------------------------------------------------------------

test("1, 12, 23: a place to type under a table that ends the note is made by an intent, checked by reduce", () => {
  // The caret can be anywhere: the line goes at the note's end, under the table.
  assert.equal(out(`Top¦\n\n${TABLE}`, below), `Top\n\n${TABLE}\n\n¦`, "no line end after the table");
  assert.equal(out(`Top¦\n\n${TABLE}\n`, below), `Top\n\n${TABLE}\n\n¦`, "one line end");
  assert.equal(out(`¦${TABLE}\n\n`, below), `${TABLE}\n\n¦`, "the line is there: only the caret moves");
  assert.equal(out(`¦${TABLE}\n\n\n`, below), `${TABLE}\n\n\n¦`, "more blank lines are kept");
  // 12: a line of spaces after the table was taken for the place, and nothing happened.
  assert.equal(out(`¦${TABLE}\n  `, below), `${TABLE}\n  \n¦`, "a line of spaces is kept, and a line goes under it");
  // Only under a table that ends the note.
  assert.match(refused(`¦${TABLE}\n\nAfter`, below), /table/);
  assert.match(refused("One¦", below), /table/);
  assert.match(refused(`¦${TABLE}\n\n${N}`, below), /table/, "a kept space is text, so the note does not end in the table");
  // A table inside a list is not the note's last block for this purpose.
  assert.match(refused("- x¦\n\n  | a |\n  |---|\n  | b |", below), /table/);
});

test("3: inserting a table above blank lines keeps them", () => {
  assert.equal(out("One¦\n\n\n\n", { type: "insertBlock", what: "table" }), "One\n\n| «Column 1» | Column 2 |\n|---|---|\n| | |\n\n\n\n");
  assert.equal(out("One¦\n\n  \n", { type: "insertBlock", what: "table" }), "One\n\n| «Column 1» | Column 2 |\n|---|---|\n| | |\n\n  \n", "a blank line holding spaces too");
  // The ordinary cases of change 12 are unchanged.
  assert.equal(out("One¦", { type: "insertBlock", what: "table" }), "One\n\n| «Column 1» | Column 2 |\n|---|---|\n| | |\n\n");
  assert.equal(out("One¦\n", { type: "insertBlock", what: "table" }), "One\n\n| «Column 1» | Column 2 |\n|---|---|\n| | |\n\n");
  assert.equal(out("One¦\n\nTwo", { type: "insertBlock", what: "table" }), "One\n\n| «Column 1» | Column 2 |\n|---|---|\n| | |\n\nTwo");
});

test("4: a line holding a kept space (U+00A0) is text, not a blank line", () => {
  // One, Enter, space, caret back in One, Insert table: the space's line was deleted and the
  // insert refused.
  const typed = out("One\n\n¦", { type: "insertText", text: " " });
  assert.equal(typed, `One\n\n${N}¦`);
  assert.equal(out(`One¦\n\n${N}`, { type: "insertBlock", what: "table" }), `One\n\n| «Column 1» | Column 2 |\n|---|---|\n| | |\n\n${N}`);
  assert.equal(out(`One¦\n\n${N}`, { type: "insertBlock", what: "rule" }), `One\n\n---\n\n¦\n\n${N}`);
});

test("5: the typing routines keep a kept space: Enter and a line break next to it", () => {
  // Enter right after a space typed at a paragraph's start: the space stays on the first line.
  assert.equal(out(`${N}¦world`, { type: "enter" }), `${N}\n\n¦world`);
  // A line break next to it: the space was dropped as if Markdown hid it.
  assert.equal(out(`a${N}¦b`, { type: "lineBreak" }), `a${N}\\\n¦b`);
  // Backspace deletes it as a character, and Ctrl+Backspace takes it as a space between words.
  assert.equal(out(`One\n\n${N}¦`, { type: "deleteBackward" }), "One\n\n¦");
  assert.equal(out(`One\n\n${N}x¦`, { type: "deleteWordBackward" }), `One\n\n${N}¦`);
  // An ordinary space at a cut is still dropped (Markdown does not keep it).
  assert.equal(out("a ¦b", { type: "enter" }), "a\n\n¦b");
  assert.equal(out("a ¦b", { type: "lineBreak" }), "a\\\n¦b");
});

test("5, 14: a no-break space typed by the person is content, not a space waiting for a letter", () => {
  // Typed U+00A0 (Option+Space, a keyboard that has it) on an empty line with a block style
  // waiting: it is text, so it starts the block.
  const r = run({ text: "One\n\n", sel: { anchor: 5, head: 5 }, typing: { marks: [], block: "h2" } }, { type: "insertText", text: N });
  assert.ok("out" in r);
  assert.equal(r.out, `One\n\n## ${N}¦`);
});

test("9: blank lines shown after the front matter can be deleted; the one hidden line stays", () => {
  const fm = "---\ntitle: x\n---\n";
  assert.equal(out(`${fm}\n\n¦`, { type: "deleteBackward" }), `${fm}\n¦`, "Backspace on the shown blank line");
  assert.equal(out(`${fm}\n¦\nHi`, { type: "deleteForward" }), `${fm}\n¦Hi`, "Delete on the shown blank line");
  assert.equal(out(`${fm}\n\n\n¦Hi`, { type: "deleteBackward" }), `${fm}\n\n¦Hi`, "Backspace at the text's start removes a shown blank line");
  // The blank line after the front matter is hidden and is not deleted.
  assert.equal(out(`${fm}\n¦Hi`, { type: "deleteBackward" }), `${fm}\n¦Hi`);
  assert.equal(out(`${fm}\n¦`, { type: "deleteBackward" }), `${fm}\n¦`);
  // The same at the top of a note with no front matter; a table above is not a blank line.
  assert.equal(out("\n\n¦Hi", { type: "deleteBackward" }), "\n¦Hi");
  assert.equal(out(`${TABLE}\n\n¦Hi`, { type: "deleteBackward" }), `${TABLE}\n\n¦Hi`);
});

// --- 2. Things that break or misbehave -----------------------------------------------------------

test("14: copy gives a kept space as an ordinary space in plain text; the app's own Markdown keeps it", () => {
  const text = `One\n\n${N}hello world`;
  const c = copySelection(text, 5, text.length);
  assert.equal(c.plain, " hello world");
  assert.equal(c.markdown, `${N}hello world`);
  // Pasted back inside the app, the space is still kept and shown.
  const p = out("One\n\n¦", { type: "paste", plain: c.plain, markdown: c.markdown });
  assert.equal(p, `One\n\n${N}hello world¦`);
  assert.equal(buildModel(p.replace("¦", "")).chars.map((x) => x.ch).join(""), `One${N}hello world`);
});

// --- 5. Tests: changes 8 and 15 had none (28) -------------------------------------------------------

import { noteSpacing, readSettings } from "../src/index.ts";

const spacing = (value: string | null): Intent => ({ type: "setMeta", key: "spacing", value });

test("28, change 8: `spacing` is written, removed at 1, bounded to 0..5 with one decimal, read-only when not valid", () => {
  const fm = "---\ntitle: X\n---\n\nHello¦";
  assert.equal(out(fm, spacing("0")), "---\ntitle: X\nspacing: 0\n---\n\nHello¦", "0 is a value");
  assert.equal(out(fm, spacing("5")), "---\ntitle: X\nspacing: 5\n---\n\nHello¦");
  assert.equal(out(fm, spacing("1.5")), "---\ntitle: X\nspacing: 1.5\n---\n\nHello¦");
  assert.equal(out("---\ntitle: X\nspacing: 2\n---\n\nHello¦", spacing("0.3")), "---\ntitle: X\nspacing: 0.3\n---\n\nHello¦", "an existing line is replaced");
  // 1 is the usual spacing: no key, and no block when it was the only key.
  assert.equal(out("---\ntitle: X\nspacing: 2\n---\n\nHello¦", spacing("1")), "---\ntitle: X\n---\n\nHello¦");
  assert.equal(out("---\nspacing: 2\n---\n\nHello¦", spacing("1")), "\nHello¦");
  assert.equal(out("Hello¦", spacing("2")), "---\nspacing: 2\n---\nHello¦", "a block is made for it");
  for (const bad of ["5.9", "6", "-1", "1.25", "2\n---", "x", "1e1"]) assert.ok("refused" in run(fm, spacing(bad)), `${JSON.stringify(bad)} is refused`);
  // Reading: a valid value, else 1; a value written by hand that is not valid is read-only.
  assert.equal(noteSpacing("---\nspacing: 2.5\n---\n\nx"), 2.5);
  assert.equal(noteSpacing("---\nspacing: 5.9\n---\n\nx"), 1);
  assert.equal(noteSpacing("x"), 1);
  const bad = readSettings("---\nspacing: 5.9\n---\n\nx").fields.spacing;
  assert.equal(bad.writable, false);
  assert.equal(readSettings("---\nspacing: 3\n---\n\nx").fields.spacing.value, "3");
  // The body's bytes do not change.
  const r = run("---\ntitle: X\n---\n\nHello  \n\n* a\r¦", spacing("2"));
  assert.ok("out" in r && r.doc.text.endsWith("\n\nHello  \n\n* a\r"));
});

test("28, change 15: a space or tab where Markdown drops it is kept as U+00A0; elsewhere a space is a space", () => {
  const ins = (text: string): Intent => ({ type: "insertText", text });
  assert.equal(out("¦", ins(" ")), `${N}¦`, "an empty note");
  assert.equal(out("One\n\n¦", ins("\t")), `One\n\n${N}${N}${N}${N}¦`, "a tab is four");
  assert.equal(out("¦Two", ins(" ")), `${N}¦Two`, "a paragraph's start");
  assert.equal(out("One¦", ins(" ")), "One ¦", "after text: an ordinary space");
  assert.equal(out("One¦ two", ins(" ")), "One ¦ two", "between words: an ordinary space");
  // What was typed shows: the visible text has the space.
  assert.equal(buildModel(`${N}Two`).chars[0].ch, N);
});

test("4, 5 (every path of the kind): the Block and List menus take a line holding a kept space as text", () => {
  // The Block menu on it styles it, rather than waiting for what is typed next.
  assert.equal(out(`${N}¦`, { type: "setBlock", kind: "h2" }), `## ${N}¦`);
  // A list started on the empty line under it is a list, not a continuation of its paragraph.
  assert.equal(out(`${N}\n¦`, { type: "setList", kind: "bullet" }), `${N}\n\n- ¦`);
});

test("found by the property test (with change 8's and 12's intents added): Bold over text that is all bold already changes nothing", () => {
  const text = "**![](note.assets/p.png)**\n\n> [***&amp;* 100%**]{size=14pt font=Caveat} **~~~~++Saudade++~~~~ beta**";
  const r = run({ text, sel: { anchor: 98, head: 2 }, typing: { marks: [], block: null } }, { type: "setMark", change: { kind: "bold", on: true } });
  assert.ok("out" in r);
  assert.equal(r.doc.text, text);
  // And off over text that has none of it.
  assert.equal(out("«plain»", { type: "setMark", change: { kind: "italic", on: false } }), "«plain»");
});
