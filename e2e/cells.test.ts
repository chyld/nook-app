// SPEC2 7.7, e2e: text typed in a table cell is written when the cell is left, whatever way it is
// left (a click in the text, a click in the search box, a click on another cell, Save, Ctrl+S),
// and is never left behind by a style or a row or column button: those carry it as `pending`.
// Each case: new note, "top", Insert > Table, click cell row 1 col 0, type "hello", leave.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import { browser, clickEditor, login, newNote, notesText, page, startServer, type Server } from "./harness.ts";

let s: Server;
let b: Browser;

before(async () => {
  s = await startServer();
  await s.addUser("alice");
  b = await browser();
});

after(async () => {
  await b?.close();
  await s?.stop();
});

const cell = (p: Page, r: number, c: number) => p.locator(`[data-testid="table-cell"][data-row="${r}"][data-col="${c}"]`);
const policyErrors = (errors: string[]) => errors.filter((e) => /Content Security Policy|Refused to/i.test(e));

/** A new note with "top" and a table, "hello" typed in cell row 1 col 0 and not yet left. */
async function typedInCell(): Promise<{ p: Page; errors: string[]; id: string; close: () => Promise<void> }> {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const { page: p, errors } = await page(ctx);
  await login(p, s.url, "alice");
  const id = await newNote(p);
  await clickEditor(p);
  await p.keyboard.type("top");
  await p.getByTestId("cmd-insert").click();
  await p.locator('[data-testid="menu-item"][data-value="table"]').click();
  await cell(p, 1, 0).click();
  await p.keyboard.type("hello");
  assert.match(await notesText(p), /\n\| +\| +\|\n\n$/, "not written while the cell has the focus");
  return { p, errors, id, close: () => ctx.close() };
}

/** The note's text on the server: saved by the step, read after a reload. */
async function savedText(p: Page): Promise<string> {
  await p.locator('[data-testid="save-status"][data-state="saved"]').waitFor();
  await p.reload();
  await p.waitForFunction(() => (window as unknown as { __notes?: unknown }).__notes !== undefined);
  return notesText(p);
}

const written = /\| hello \| +\|/;

/** Waits until the note's text passes a check (polled from Node: the page's policy forbids eval). */
async function until(p: Page, check: (t: string) => boolean): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const t = await notesText(p);
    if (check(t)) return t;
    await p.waitForTimeout(50);
  }
  return notesText(p);
}

for (const [name, leave] of [
  ["a click in the note's text", async (p: Page) => p.getByTestId("editor").getByText("top", { exact: true }).click()],
  ["a click in the search box", async (p: Page) => p.getByTestId("search").click()],
  ["a click on another cell", async (p: Page) => cell(p, 0, 1).click()],
] as const) {
  test(`leaving a cell by ${name} writes it; Save then saves it`, async () => {
    const { p, errors, close } = await typedInCell();
    await leave(p);
    assert.match(await until(p, (t) => written.test(t)), written);
    await p.getByTestId("save").click();
    assert.match(await savedText(p), written);
    assert.deepEqual(policyErrors(errors), []);
    await close();
  });
}

test("Save while a cell has the focus writes the cell first, then saves", async () => {
  const { p, close } = await typedInCell();
  await p.getByTestId("save").click();
  assert.match(await savedText(p), written);
  await close();
});

test("Ctrl+S while a cell has the focus writes the cell first, then saves", async () => {
  const { p, close } = await typedInCell();
  await p.keyboard.press("Control+s");
  assert.match(await savedText(p), written);
  await close();
});

test("a style button with unsaved cell text: the text and the style are one edit", async () => {
  const { p, close } = await typedInCell();
  await p.getByTestId("cmd-bold").click();
  await until(p, (t) => t.includes("**hello**"));
  await p.getByTestId("save").click();
  assert.match(await savedText(p), /\| \*\*hello\*\* \| +\|/);
  await close();
});

for (const [testid, check] of [
  ["table-add-row", (t: string) => /\| hello \| +\|\n\| +\| +\|\n\n$/.test(t)],
  ["table-add-column", (t: string) => /\| hello \| +\| +\|/.test(t)],
] as const) {
  test(`${testid} with unsaved cell text: the text goes with the operation`, async () => {
    const { p, close } = await typedInCell();
    await p.getByTestId(testid).click();
    const t = await until(p, check);
    assert.ok(check(t), t);
    await p.getByTestId("save").click();
    assert.ok(check(await savedText(p)));
    await close();
  });
}

// The remove buttons act on the cell in use, so its row or column goes with its unsaved text;
// text written before stays.
for (const [add, remove, check] of [
  ["table-add-row", "table-remove-row", (t: string) => /\| hello \| +\|\n\n$/.test(t) && !t.includes("bye")],
  ["table-add-column", "table-remove-column", (t: string) => /\| hello \| +\|$/m.test(t) && !t.includes("bye")],
] as const) {
  test(`${remove} with unsaved cell text: nothing else is lost`, async () => {
    const { p, close } = await typedInCell();
    await p.getByTestId(add).click();
    await until(p, (t) => t.includes("| hello |"));
    await p.keyboard.type("bye");
    await p.getByTestId(remove).click();
    const t = await until(p, check);
    assert.ok(check(t), t);
    await p.getByTestId("save").click();
    assert.ok(check(await savedText(p)));
    await close();
  });
}

// Finding 1 of the code review: every other way of leaving the note, or of drawing the table
// otherwise, writes the focused cell too.

/** The draft offered when the note is opened again, opened: the note's text then. */
async function openOfferedDraft(p: Page): Promise<string> {
  await p.getByTestId("draft-open").click();
  return until(p, (t) => written.test(t));
}

test("reloading the page with text in a cell asks first, and the draft holds the cell's text", async () => {
  const { p, close } = await typedInCell();
  const dialogs: string[] = [];
  p.on("dialog", (d) => {
    dialogs.push(d.type());
    void d.accept();
  });
  await p.reload();
  await p.waitForFunction(() => (window as unknown as { __notes?: unknown }).__notes !== undefined);
  assert.deepEqual(dialogs, ["beforeunload"], "the page asks before it is left");
  assert.match(await openOfferedDraft(p), written);
  await close();
});

test("closing the tab with text in a cell asks first, and the draft holds the cell's text", async () => {
  const { p, id, close } = await typedInCell();
  const dialogs: string[] = [];
  p.on("dialog", (d) => {
    dialogs.push(d.type());
    void d.accept();
  });
  const ctx = p.context();
  await p.close({ runBeforeUnload: true });
  await p.waitForEvent("close");
  assert.deepEqual(dialogs, ["beforeunload"]);
  const { page: q } = await page(ctx);
  await q.goto(`${s.url}/n/${id}`);
  await q.waitForFunction(() => (window as unknown as { __notes?: unknown }).__notes !== undefined);
  assert.match(await openOfferedDraft(q), written);
  await close();
});

test("browser Back with text in a cell asks first; staying keeps the cell's text in the note", async () => {
  const { p, close } = await typedInCell();
  await p.goBack();
  await p.getByTestId("cancel").click();
  assert.match(p.url(), /\/n\//);
  assert.match(await until(p, (t) => written.test(t)), written);
  await close();
});

for (const [name, testid] of [
  ["the Rich/Raw button", "mode-toggle"],
  ["Edit as text", "table-as-text"],
] as const) {
  test(`${name} with text in a cell writes the cell first`, async () => {
    const { p, close } = await typedInCell();
    await p.getByTestId(testid).click();
    assert.match(await until(p, (t) => written.test(t)), written);
    await p.getByTestId("save").click();
    assert.match(await savedText(p), written);
    await close();
  });
}

test("finding 2: a space added at a cell's end and left does not stop later edits of the table", async () => {
  const { p, close } = await typedInCell();
  await cell(p, 0, 1).click();
  await until(p, (t) => written.test(t));
  await cell(p, 1, 0).click();
  await p.keyboard.press("End");
  await p.keyboard.type(" ");
  await cell(p, 1, 1).click();
  await p.keyboard.type("bye");
  await cell(p, 0, 1).click();
  const t = await until(p, (x) => x.includes("bye"));
  assert.match(t, /\| hello \| bye \|/);
  await close();
});

test("finding 3: Save with an unchanged cell focused, more typed in it, Save again: the new text is saved", async () => {
  const { p, close } = await typedInCell();
  await cell(p, 0, 1).click();
  await until(p, (t) => written.test(t));
  await cell(p, 1, 0).click();
  await p.getByTestId("save").click();
  await p.locator('[data-testid="save-status"][data-state="saved"]').waitFor();
  await p.keyboard.press("End");
  await p.keyboard.type(" more");
  await p.getByTestId("save").click();
  assert.match(await savedText(p), /\| hello more \|/);
  await close();
});
