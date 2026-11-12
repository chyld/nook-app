// Findings of the review of alpha's changes (CHANGES-REVIEW-FINDINGS.md) that only show in the
// browser. Test ids only; the note's text is set and read through window.__notes. Each test
// names its finding.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
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

type Notes = { text(): string; select(a: number, b?: number): void; intent(i: unknown): boolean };

const cell = (p: Page, r: number, c: number) => p.locator(`[data-testid="table-cell"][data-row="${r}"][data-col="${c}"]`);

async function fresh(width = 1280): Promise<{ p: Page; errors: string[]; close: () => Promise<void> }> {
  const ctx = await b.newContext({ viewport: { width, height: 800 } });
  const { page: p, errors } = await page(ctx);
  await login(p, s.url, "alice");
  return { p, errors, close: () => ctx.close() };
}

/** Sets the whole text of the open note (in Raw, as one paste), then goes back to Rich. */
async function setText(p: Page, text: string): Promise<void> {
  await p.getByTestId("mode-toggle").click();
  await p.locator('[data-testid="editor"][data-mode="raw"]').waitFor();
  await p.evaluate((t) => {
    const n = (window as unknown as { __notes: Notes }).__notes;
    n.select(0, n.text().length);
    n.intent({ type: "paste", plain: t });
  }, text);
  await p.getByTestId("mode-toggle").click();
  await p.locator('[data-testid="editor"][data-mode="rich"]').waitFor();
  assert.equal(await notesText(p), text);
}

/** Waits until the note's text passes a check. */
async function until(p: Page, check: (t: string) => boolean): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const t = await notesText(p);
    if (check(t)) return t;
    await p.waitForTimeout(50);
  }
  return notesText(p);
}

/** A click in the editor, under everything in the note. */
async function clickBelow(p: Page): Promise<void> {
  const box = (await p.getByTestId("editor").boundingBox())!;
  await p.mouse.click(box.x + box.width / 2, box.y + box.height - 30);
}

// --- 1. Lost or damaged text ---------------------------------------------------------------------

const TABLE = "| a | b |\n|---|---|\n| c | d |";
// (A table written from its cells has the writer's own delimiter row.)

for (const [name, edit, want] of [
  ["grew", async (p: Page) => p.keyboard.type("hello"), `Top\n\n| a | b |\n| --- | --- |\n| chello | d |\n\n`],
  ["shrank", async (p: Page) => p.keyboard.press("Backspace"), `Top\n\n| a | b |\n| --- | --- |\n| | d |\n\n`],
] as const) {
  test(`1, 23: a click under a final table after typing in its last row (the cell ${name}): the cell is written, then the line goes under the table`, async () => {
    const { p, errors, close } = await fresh();
    await newNote(p);
    await setText(p, `Top\n\n${TABLE}`);
    await cell(p, 1, 0).click();
    await edit(p);
    await clickBelow(p);
    const t = await until(p, (x) => x === want);
    assert.equal(t, want);
    // The caret is on the new line, at the note's end: typing goes there.
    await p.keyboard.type("after");
    assert.equal(await until(p, (x) => x.endsWith("after")), want + "after");
    assert.deepEqual(errors.filter((e) => !/Failed to load resource/.test(e)), [], "no errors on the page (an exception would show here)");
    await close();
  });
}

test("12, 23: a click under a final table followed by a line of spaces adds the line under it", async () => {
  const { p, close } = await fresh();
  await newNote(p);
  await setText(p, `Top\n\n${TABLE}\n  `);
  await clickBelow(p);
  await p.keyboard.type("x");
  assert.equal(await until(p, (t) => t.endsWith("x")), `Top\n\n${TABLE}\n  \nx`);
  await close();
});

test("2: Tab out of a cell whose write is refused stays in the cell, with what was typed", async () => {
  const { p, close } = await fresh();
  await newNote(p);
  await setText(p, `Top\n\n${TABLE}\n\n`);
  await cell(p, 1, 0).click();
  // A character a cell cannot hold (the write is refused), as if typed.
  await p.evaluate(() => document.activeElement!.append(document.createTextNode("x\u0000")));
  await p.keyboard.press("Tab");
  await p.getByTestId("toast").first().waitFor();
  const focused = await p.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el ? `${el.dataset.row}:${el.dataset.col}:${el.textContent}` : "";
  });
  assert.equal(focused, "1:0:cx\u0000", "the focus stayed in the cell, and its text with it");
  assert.equal(await notesText(p), `Top\n\n${TABLE}\n\n`, "nothing was written");
  // Escape discards it, as for any cell.
  await p.keyboard.press("Escape");
  assert.equal(await cell(p, 1, 0).textContent(), "c");
  await close();
});

/** A note holding one uploaded photo with no width. */
async function withPhoto(p: Page): Promise<void> {
  await newNote(p);
  await clickEditor(p);
  const png = await sharp({ create: { width: 800, height: 400, channels: 3, background: "#3366cc" } }).png().toBuffer();
  await p.getByTestId("photo-input").setInputFiles({ name: "sky.png", mimeType: "image/png", buffer: png });
  await p.getByTestId("photo").waitFor();
  await p.waitForFunction(() => {
    const i = document.querySelector('[data-testid="photo"] img') as HTMLImageElement | null;
    return !!i && i.complete && i.naturalWidth > 0;
  });
}

/** A drag on a photo handle by synthetic pointer events, ended by `end` (pointerup or pointercancel). */
async function drag(p: Page, testid: string, by: number, end: "pointerup" | "pointercancel"): Promise<void> {
  await p.evaluate(
    ([id, dx, last]) => {
      const h = document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
      const r = h.getBoundingClientRect();
      const at = { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, pointerId: 7, bubbles: true, button: 0 };
      h.dispatchEvent(new PointerEvent("pointerdown", at));
      h.dispatchEvent(new PointerEvent("pointermove", { ...at, clientX: at.clientX + (dx as number) }));
      h.dispatchEvent(new PointerEvent(last as string, { ...at, clientX: at.clientX + (dx as number) }));
    },
    [testid, by, end] as const,
  );
}

const photoState = (p: Page) => p.evaluate(() => {
  const box = document.querySelector('[data-testid="photo"]') as HTMLElement;
  return { width: box.style.width, hasWidth: box.classList.contains("has-width"), resizing: box.classList.contains("is-resizing") };
});

test("6: a cancelled drag of a photo handle writes nothing and leaves the photo as it was", async () => {
  const { p, close } = await fresh();
  await withPhoto(p);
  const before = await notesText(p);
  await drag(p, "photo-handle-e", -150, "pointercancel");
  await p.waitForTimeout(100);
  assert.equal(await notesText(p), before, "no width was written");
  assert.deepEqual(await photoState(p), { width: "", hasWidth: false, resizing: false });
  await close();
});

test("6: a drag of under 2 px writes nothing and leaves the photo with no width", async () => {
  const { p, close } = await fresh();
  await withPhoto(p);
  const before = await notesText(p);
  await drag(p, "photo-handle-w", 1, "pointerup");
  await p.waitForTimeout(100);
  assert.equal(await notesText(p), before);
  assert.deepEqual(await photoState(p), { width: "", hasWidth: false, resizing: false });
  // A real drag still writes a width.
  await drag(p, "photo-handle-e", -150, "pointerup");
  assert.match(await until(p, (t) => /\{width=\d+%\}/.test(t)), /\{width=\d+%\}/);
  await close();
});

// --- 2. Things that break or misbehave -----------------------------------------------------------

test("8: invisibles on, a line with a photo in it (a long hidden range): the marks are drawn, and stay after typing", async () => {
  const { p, errors, close } = await fresh();
  await newNote(p);
  await setText(p, "a b ![](note.assets/none.png) c d\nnext line here");
  await p.getByTestId("cmd-invisibles").click();
  await p.locator(".inv-space").first().waitFor();
  const count = () => p.locator('[data-testid="editor"] .inv-space').count();
  assert.ok((await count()) >= 4, `${await count()} spaces marked`);
  await p.evaluate(() => (window as unknown as { __notes: Notes }).__notes.select(1));
  await p.keyboard.type(" x");
  await until(p, (t) => t.startsWith("a x b"));
  assert.ok((await count()) >= 5, "still drawn after typing: the plugin was not turned off");
  assert.deepEqual(errors.filter((e) => /crashed|RangeSetBuilder|Ranges must be added sorted/i.test(e)), []);
  await close();
});

/** The element at the middle of a handle, and whether it is that handle. */
const handleHit = (p: Page, testid: string) =>
  p.evaluate((id) => {
    const h = document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
    const r = h.getBoundingClientRect();
    return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === h;
  }, testid);

test("10: a photo's handles take no clicks until the photo is under the pointer", async () => {
  const { p, close } = await fresh();
  await withPhoto(p);
  await p.mouse.move(5, 5);
  for (const id of ["photo-handle", "photo-handle-e", "photo-handle-w", "photo-handle-s", "photo-handle-sw"]) assert.equal(await handleHit(p, id), false, `${id} is hidden and takes no click`);
  const box = (await p.getByTestId("photo").boundingBox())!;
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  assert.equal(await handleHit(p, "photo-handle-e"), true, "shown on hover, and it can be dragged");
  await close();
});

test("10: on a touch screen the handles are inside the photo, so the strip around it scrolls", async () => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  const { page: p } = await page(ctx);
  await login(p, s.url, "alice");
  await withPhoto(p);
  const inside = await p.evaluate(() => {
    const box = document.querySelector('[data-testid="photo"]')!.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>(".rich-photo-handle")].every((h) => {
      const r = h.getBoundingClientRect();
      return r.left >= box.left - 0.5 && r.right <= box.right + 0.5 && r.bottom <= box.bottom + 0.5 && getComputedStyle(h).opacity === "1";
    });
  });
  assert.ok(inside);
  await ctx.close();
});

test("11: Insert table puts the focus in its first cell at once, with the text selected; typing replaces it", async () => {
  const { p, close } = await fresh();
  await newNote(p);
  await setText(p, "Top");
  await p.evaluate(() => (window as unknown as { __notes: Notes }).__notes.select(3));
  // In the same task as the insert: no frame can pass in which a key or click goes elsewhere.
  const now = await p.evaluate(() => {
    (window as unknown as { __notes: Notes }).__notes.intent({ type: "insertBlock", what: "table" });
    const el = document.activeElement as HTMLElement | null;
    return el ? `${el.dataset.testid}:${el.dataset.row}:${el.dataset.col}:${getSelection()?.toString()}` : "";
  });
  assert.equal(now, "table-cell:0:0:Column 1");
  await p.keyboard.type("Name");
  await p.keyboard.press("Tab");
  assert.match(await until(p, (t) => t.includes("| Name |")), /^Top\n\n\| Name \| Column 2 \|/);
  await close();
});

test("13: after a failed page of fonts, Try again loads it and the pages after it", async () => {
  const { p, close } = await fresh();
  const families = Array.from({ length: 300 }, (_, i) => ({ family: `Font ${i}`, slug: `font-${i}`, category: "Sans Serif" }));
  let failOnce = true;
  const asked: number[] = [];
  await p.route("**/api/fonts/catalogue*", (r) => {
    const offset = Number(new URL(r.request().url()).searchParams.get("offset") ?? 0);
    asked.push(offset);
    if (offset === 30 && failOnce) {
      failOnce = false;
      return r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "x", message: "broken" } }) });
    }
    return r.fulfill({ contentType: "application/json", body: JSON.stringify({ families: families.slice(offset, offset + 30), total: families.length, categories: ["Sans Serif"], available: true }) });
  });
  await p.getByTestId("nav-fonts").click();
  await p.getByText("More fonts could not be loaded.").waitFor();
  await p.getByRole("button", { name: "Try again" }).click();
  await p.locator('[data-testid="font-row"][data-slug="font-59"]').waitFor();
  await p.locator('[data-testid="font-row"][data-slug="font-59"]').scrollIntoViewIfNeeded();
  await p.locator('[data-testid="font-row"][data-slug="font-89"]').waitFor({ timeout: 5000 });
  assert.ok(asked.filter((o) => o === 30).length === 2 && asked.includes(60), JSON.stringify(asked));
  await close();
});

test("13: a page that adds nothing is not asked for again and again", async () => {
  const { p, close } = await fresh();
  const families = Array.from({ length: 30 }, (_, i) => ({ family: `Font ${i}`, slug: `font-${i}`, category: "Sans Serif" }));
  let asked = 0;
  await p.route("**/api/fonts/catalogue*", (r) => {
    asked++;
    // Says there are 100, but every page is the first one again.
    return r.fulfill({ contentType: "application/json", body: JSON.stringify({ families, total: 100, categories: [], available: true }) });
  });
  await p.getByTestId("nav-fonts").click();
  await p.locator('[data-testid="font-row"][data-slug="font-29"]').waitFor();
  await p.waitForTimeout(1500);
  assert.ok(asked <= 3, `the catalogue was asked for ${asked} times`);
  await p.getByText("More fonts could not be loaded.").waitFor();
  await close();
});

test("16: while an IME composes with a size waiting, the composed text is drawn at that size, and stays so", async () => {
  const { p, close } = await fresh();
  await newNote(p);
  await setText(p, "Hi ");
  await p.evaluate(() => (window as unknown as { __notes: Notes }).__notes.select(3));
  await p.evaluate(() => (window as unknown as { __notes: Notes }).__notes.intent({ type: "setMark", change: { kind: "size", pt: 24 } }));
  const cdp = await p.context().newCDPSession(p);
  const sizeAtCaret = () =>
    p.evaluate(() => {
      const n = getSelection()?.anchorNode;
      const el = n?.nodeType === Node.TEXT_NODE ? n.parentElement : (n as HTMLElement | null);
      return el ? getComputedStyle(el).fontSize : "";
    });
  await cdp.send("Input.imeSetComposition", { text: "하", selectionStart: 1, selectionEnd: 1 });
  await cdp.send("Input.imeSetComposition", { text: "한", selectionStart: 1, selectionEnd: 1 });
  assert.equal(await sizeAtCaret(), "32px", "24pt while composing");
  await cdp.send("Input.insertText", { text: "한" });
  await p.waitForTimeout(150);
  // What typing 한 there writes (the space before it goes into the span: core's routine).
  assert.equal(await notesText(p), "Hi[ 한]{size=24pt}");
  const sizeOfText = await p.evaluate(() => {
    const w = document.createTreeWalker(document.querySelector(".cm-content")!, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (n.textContent?.includes("한")) return getComputedStyle(n.parentElement!).fontSize;
    return "";
  });
  assert.equal(sizeOfText, "32px", "and after: no jump");
  await close();
});

// --- 3. Looks and access ---------------------------------------------------------------------------

test("18: on a narrow phone (280 px, a folding phone's outer screen) the fonts page's search row fits", async () => {
  const { p, close } = await fresh(280);
  const families = Array.from({ length: 30 }, (_, i) => ({ family: `Font ${i}`, slug: `font-${i}`, category: "Sans Serif" }));
  await p.route("**/api/fonts/catalogue*", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ families, total: 30, categories: ["Sans Serif", "Serif"], available: true }) }));
  await p.goto(`${s.url}/fonts`);
  await p.locator('[data-testid="font-row"]').first().waitFor();
  // The row and its boxes stay inside the page's content box (its side gutters kept), and the
  // page does not scroll sideways.
  const over = await p.evaluate(() => {
    const page = document.querySelector(".fonts")!.getBoundingClientRect();
    const out = [...document.querySelectorAll<HTMLElement>(".filters, .filters *")].filter((el) => el.getBoundingClientRect().right > page.right + 0.5).map((el) => el.className || el.tagName);
    return { out, scrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  });
  assert.deepEqual(over, { out: [], scrolls: false });
  await close();
});

test("19: a photo has one width slider, named and with its value, that the keyboard can use", async () => {
  const { p, close } = await fresh();
  await withPhoto(p);
  const sliders = p.getByRole("slider");
  assert.equal(await sliders.count(), 1, "one slider, not five");
  const slider = p.getByRole("slider", { name: "Photo width" });
  await slider.focus();
  const start = Number(await slider.getAttribute("aria-valuenow"));
  assert.ok(start >= 5 && start <= 100, `value ${start}`);
  await p.keyboard.press("ArrowLeft");
  const want = Math.max(5, start - 5);
  assert.match(await until(p, (t) => t.includes(`{width=${want}%}`)), new RegExp(`\\{width=${want}%\\}`));
  // The focus stays on the slider of the photo, drawn again; the next key goes on from there.
  assert.equal(await p.evaluate(() => document.activeElement?.getAttribute("data-testid")), "photo-handle");
  await p.keyboard.press("ArrowLeft");
  assert.match(await until(p, (t) => t.includes(`{width=${want - 5}%}`)), new RegExp(`\\{width=${want - 5}%\\}`));
  assert.equal(await p.getByRole("slider", { name: "Photo width" }).getAttribute("aria-valuenow"), String(want - 5));
  await close();
});

test("20: text in a table is drawn at the note's size, as the paragraphs beside it are", async () => {
  const { p, close } = await fresh();
  await newNote(p);
  await setText(p, "---\nsize: 18pt\n---\n\nAbove\n\n| a | b |\n|---|---|\n| c | d |\n\n");
  const sizes = await p.evaluate(() => {
    const size = (el: Element | null) => (el ? getComputedStyle(el).fontSize : "");
    const para = [...document.querySelectorAll(".cm-content .rich-run")].find((e) => e.textContent === "Above") ?? null;
    return { para: size(para), cell: size(document.querySelector('[data-testid="table-cell"][data-row="1"][data-col="0"]')) };
  });
  assert.deepEqual(sizes, { para: "24px", cell: "24px" });
  await close();
});

// --- 5. Tests the changes had none of (28) -----------------------------------------------------------

test("28, change 7: a size chosen with nothing selected is shown at the caret, and the typed text gets it", async () => {
  const { p, close } = await fresh();
  await newNote(p);
  await setText(p, "Hi ");
  await p.evaluate(() => (window as unknown as { __notes: Notes }).__notes.select(3));
  await p.evaluate(() => (window as unknown as { __notes: Notes }).__notes.intent({ type: "setMark", change: { kind: "size", pt: 24 } }));
  const caretSize = () => p.evaluate(() => {
    const w = document.querySelector(".rich-typing-caret");
    return w ? getComputedStyle(w).fontSize : null;
  });
  assert.equal(await caretSize(), "32px");
  await p.keyboard.type("x");
  assert.equal(await until(p, (t) => t.includes("x")), "Hi[ x]{size=24pt}");
  assert.equal(await caretSize(), null, "the waiting size was used: the caret is ordinary again");
  await close();
});

for (const [id, by, down] of [
  ["photo-handle-e", -150, 0],
  ["photo-handle-w", 150, 0],
  ["photo-handle-s", 0, -60],
  ["photo-handle-sw", 150, 0],
] as const) {
  test(`28, change 9: dragging ${id} inwards makes the photo narrower`, async () => {
    const { p, close } = await fresh();
    await withPhoto(p);
    const box = (await p.getByTestId("photo").boundingBox())!;
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const h = (await p.getByTestId(id).boundingBox())!;
    await p.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await p.mouse.down();
    await p.mouse.move(h.x + h.width / 2 + by, h.y + h.height / 2 + down, { steps: 6 });
    await p.mouse.up();
    const t = await until(p, (x) => /\{width=\d+%\}/.test(x));
    const w = Number(/\{width=(\d+)%\}/.exec(t)?.[1]);
    assert.ok(w >= 5 && w < 100, `width ${w}`);
    await close();
  });
}

test("28, change 10: a table sits at the left of the text, as wide as its cells", async () => {
  const { p, close } = await fresh();
  await newNote(p);
  await setText(p, "Above\n\n| a | b |\n|---|---|\n| c | d |\n\n");
  const at = await p.evaluate(() => {
    const para = [...document.querySelectorAll(".cm-content .rich-run")].find((e) => e.textContent === "Above")!.getBoundingClientRect();
    const table = document.querySelector('[data-testid="table"] table')!.getBoundingClientRect();
    const line = document.querySelector('[data-testid="table"]')!.getBoundingClientRect();
    return { left: Math.round(table.left - para.left), narrower: table.width < line.width / 2, tables: document.querySelectorAll('[data-testid="table"] table').length };
  });
  assert.deepEqual(at, { left: 0, narrower: true, tables: 1 });
  await close();
});
