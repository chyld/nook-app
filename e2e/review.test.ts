// Findings of the version 2 code review that only show in the browser: the history screen (9a,
// 30), drafts on the home screen (9b, 9c) and the sidebar on a phone (35c). Test ids only; the
// note is driven by window.__notes.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import { browser, login, newNote, notesText, page, startServer, type Server } from "./harness.ts";

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

/** Puts the caret at the end of the note and types. */
async function typeAtEnd(p: Page, text: string): Promise<void> {
  const len = (await notesText(p)).length;
  await p.evaluate((n) => (window as unknown as { __notes: { select(a: number): void } }).__notes.select(n), len);
  await p.keyboard.type(text);
}

async function save(p: Page): Promise<void> {
  await p.getByTestId("save").click();
  await p.locator('[data-testid="save-status"][data-state="saved"]').waitFor();
}

/** A note saved twice, so its history holds two versions; then its history screen. */
async function withHistory(p: Page): Promise<string> {
  const id = await newNote(p);
  await typeAtEnd(p, "first");
  await save(p);
  await typeAtEnd(p, " second");
  await save(p);
  await p.getByTestId("note-settings").click();
  await p.getByTestId("note-history").click();
  await p.locator('[data-testid="history-row"]').nth(1).waitFor();
  return id;
}

test("9a: when a version cannot be read, Restore is not offered (it would save an empty note)", async () => {
  const ctx = await b.newContext();
  const { page: p } = await page(ctx);
  await login(p, s.url, "alice");
  const id = await withHistory(p);
  await p.route(`**/api/notes/${id}/history/*`, (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "x", message: "broken" } }) }));
  const answered = p.waitForResponse((r) => r.url().includes(`/api/notes/${id}/history/`));
  await p.locator('[data-testid="history-row"]').first().click();
  await answered;
  await p.waitForTimeout(100);
  const restore = p.getByTestId("history-restore");
  assert.ok((await restore.count()) === 0 || (await restore.isDisabled()), "Restore is not offered");
  await ctx.close();
});

test("30: a slow answer for one version is not shown under another", async () => {
  const ctx = await b.newContext();
  const { page: p } = await page(ctx);
  await login(p, s.url, "alice");
  const id = await withHistory(p);
  const rows = p.locator('[data-testid="history-row"]');
  const slow = await rows.nth(0).getAttribute("data-version");
  // The first version picked answers late, after the second.
  await p.route(`**/api/notes/${id}/history/${slow}`, async (r) => {
    await new Promise((x) => setTimeout(x, 700));
    await r.continue();
  });
  await rows.nth(0).click();
  await rows.nth(1).click();
  await p.waitForTimeout(1200);
  // Newest first: row 0 is the text before the second save ("first"); row 1, picked last, is
  // the note as it was made, with no words in it.
  const shown = await p.locator("article").innerText();
  assert.doesNotMatch(shown, /first/, "the slow answer for row 0 is shown under row 1");
  await ctx.close();
});

/** A note with unsaved text, then the home screen (the page asks; the draft is kept). */
async function draftThenHome(p: Page): Promise<void> {
  await newNote(p);
  await typeAtEnd(p, "unsaved words");
  p.on("dialog", (d) => void d.accept());
  await p.goto(`${s.url}/`);
  await p.getByTestId("sidebar").waitFor();
}

test("9b: a draft whose note is hidden by the search is not called gone", async () => {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const { page: p } = await page(ctx);
  await login(p, s.url, "alice");
  await draftThenHome(p);
  await p.getByTestId("search").fill("zzzz-no-such-text");
  await p.waitForFunction(() => document.querySelectorAll('[data-testid="note-row"]').length === 0);
  await p.waitForTimeout(400);
  const row = p.locator('[data-testid="draft-row"]').first();
  assert.equal(await row.getByTestId("save-as-new").count(), 0, "not offered as a note that is gone");
  assert.equal(await row.getByTestId("draft-open").count(), 1);
  await ctx.close();
});

test("9c and 35c: on a phone, Fold at home shows the drafts; the notes button brings the sidebar back", async () => {
  const ctx = await b.newContext({ viewport: { width: 400, height: 800 } });
  const { page: p } = await page(ctx);
  await login(p, s.url, "alice");
  await draftThenHome(p);
  assert.equal(await p.locator('[data-testid="draft-row"]').first().isVisible(), false, "the sidebar is the home screen");
  await p.getByTestId("sidebar-fold").click();
  await p.locator('[data-testid="draft-row"]').first().waitFor({ state: "visible", timeout: 2000 });
  assert.equal(await p.locator('[data-testid="draft-discard"]').first().isVisible(), true);
  await p.getByTestId("notes-button").click();
  await p.getByTestId("sidebar").waitFor({ state: "visible", timeout: 2000 });
  await ctx.close();
});

test("35c: on a phone, the note under the open sheet cannot be reached by Tab", async () => {
  const ctx = await b.newContext({ viewport: { width: 400, height: 800 } });
  const { page: p } = await page(ctx);
  await login(p, s.url, "alice");
  await newNote(p);
  const before = await notesText(p);
  await p.getByTestId("notes-button").click();
  await p.getByTestId("sidebar").waitFor({ state: "visible" });
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await p.keyboard.press("Tab");
    reached = await p.evaluate(() => {
      const a = document.activeElement;
      return !!a && !a.closest('[data-testid="sidebar"]') && a !== document.body;
    });
  }
  assert.equal(reached, false, "Tab stays in the sheet");
  await p.keyboard.type("x");
  assert.equal(await notesText(p), before);
  await ctx.close();
});

// --- 23, 24, 25, 27, 29: the table widget and the editor's keys ---

const cellAt = (p: Page, r: number, c: number) => p.locator(`[data-testid="table-cell"][data-row="${r}"][data-col="${c}"]`);

/** A new note with "top" and an empty two-column table. */
async function withTable(p: Page): Promise<void> {
  await newNote(p);
  await typeAtEnd(p, "top");
  await p.getByTestId("cmd-insert").click();
  await p.locator('[data-testid="menu-item"][data-value="table"]').click();
  await cellAt(p, 1, 0).waitFor();
}

async function until(p: Page, check: (t: string) => boolean): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const t = await notesText(p);
    if (check(t)) return t;
    await p.waitForTimeout(50);
  }
  return notesText(p);
}

async function fresh(): Promise<{ p: Page; close: () => Promise<void> }> {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const { page: p } = await page(ctx);
  await login(p, s.url, "alice");
  return { p, close: () => ctx.close() };
}

test("23: Enter that confirms an IME candidate in a cell stays in the cell", async () => {
  const { p, close } = await fresh();
  await withTable(p);
  await cellAt(p, 1, 0).click();
  await p.keyboard.type("ni");
  await cellAt(p, 1, 0).evaluate((el) => el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, isComposing: true, bubbles: true, cancelable: true })));
  const inCell = await p.evaluate(() => document.activeElement?.getAttribute("data-row") === "1" && document.activeElement?.getAttribute("data-col") === "0");
  assert.equal(inCell, true, "the focus did not move to another cell");
  await close();
});

test("24: the toolbar in a cell follows the selection in it, so Bold over mixed text turns it on", async () => {
  const { p, close } = await fresh();
  await withTable(p);
  await cellAt(p, 1, 0).click();
  await p.keyboard.type("aa bb");
  await cellAt(p, 0, 1).click();
  await until(p, (t) => t.includes("| aa bb |"));
  await cellAt(p, 1, 0).click();
  await p.keyboard.press("Home");
  await p.keyboard.press("Shift+ArrowRight");
  await p.keyboard.press("Shift+ArrowRight");
  await p.getByTestId("cmd-bold").click();
  await until(p, (t) => t.includes("**aa** bb"));
  // Now the whole cell, by the keyboard only: part of it is not bold, so Bold turns it on.
  await p.keyboard.press("Home");
  await p.keyboard.press("Shift+End");
  await p.waitForTimeout(100);
  await p.getByTestId("cmd-bold").click();
  const t = await until(p, (x) => x.includes("**aa bb**"));
  assert.match(t, /\| \*\*aa bb\*\* \|/);
  await close();
});

test("25: a paste in a cell can be undone before the cell is left", async () => {
  const { p, close } = await fresh();
  await withTable(p);
  await cellAt(p, 1, 0).click();
  await p.keyboard.type("kept");
  await cellAt(p, 1, 0).evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "pasted");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  assert.equal(await cellAt(p, 1, 0).innerText(), "keptpasted");
  await p.keyboard.press("Control+z");
  // The browser may group the paste with the typing before it; either way the paste goes.
  assert.doesNotMatch(await cellAt(p, 1, 0).innerText(), /pasted/);
  await close();
});

test("27: a style key in a cell edited as Markdown says why nothing happened", async () => {
  const { p, close } = await fresh();
  await newNote(p);
  await p.getByTestId("mode-toggle").click();
  await typeAtEnd(p, "\n\n| a | b |\n|---|---|\n| ![](note.assets/x.png) | c |\n");
  await p.getByTestId("mode-toggle").click();
  await cellAt(p, 1, 0).click();
  await p.keyboard.press("Control+b");
  await p.locator('[data-testid="toast"]', { hasText: "Markdown" }).waitFor({ timeout: 2000 });
  await close();
});

test("29: Ctrl+K with nothing selected is refused; the link panel does not open", async () => {
  const { p, close } = await fresh();
  await newNote(p);
  await typeAtEnd(p, "words");
  await p.keyboard.press("Control+k");
  await p.locator('[data-testid="toast"]', { hasText: "Select some text first" }).waitFor({ timeout: 2000 });
  assert.equal(await p.getByTestId("link-address").count(), 0);
  await close();
});

test("29: text dropped into a table shown as text goes in", async () => {
  const { p, close } = await fresh();
  await withTable(p);
  await p.getByTestId("table-as-text").click();
  await p.waitForTimeout(100);
  const box = (await p.getByTestId("editor").locator("text=Column 1").first().boundingBox())!;
  await p.getByTestId("editor").evaluate(
    (el, at) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", "DROPPED");
      const target = document.elementFromPoint(at.x, at.y) ?? el;
      for (const type of ["dragenter", "dragover", "drop"]) target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, clientX: at.x, clientY: at.y, bubbles: true, cancelable: true }));
    },
    { x: box.x + 2, y: box.y + box.height / 2 },
  );
  assert.match(await until(p, (t) => t.includes("DROPPED")), /DROPPED/);
  await close();
});

test("35b: when listing the notes fails, the sidebar says so and offers to try again", async () => {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const { page: p } = await page(ctx);
  let failed = 0;
  await p.route("**/api/notes", (r) => (r.request().method() === "GET" && failed++ === 0 ? r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "x", message: "broken" } }) }) : r.continue()));
  await login(p, s.url, "alice");
  const again = p.getByTestId("sidebar").getByRole("button", { name: "Try again" });
  await again.waitFor({ timeout: 3000 });
  await again.click();
  await p.locator('[data-testid="note-row"]').first().waitFor({ timeout: 3000 });
  await ctx.close();
});
