// SPEC-DRAWINGS 8, e2e, under the real policy: create a drawing, add text, save, reload, and it
// is not unsaved; only the background changed is unsaved; a change followed at once by leaving
// asks first; an image added, saved, reloaded and seen; a scene file with an image loaded from
// disk, saved and reloaded; a file from excalidraw.com placed in the folder opens with its image;
// a draft opened after a reload; a library item kept after a reload; a conflict in two tabs;
// trash and restore; history and restore; Ctrl+S; a drawing and a note in turn; a note requests
// no Excalidraw file; no font comes from another address.
//
// Excalidraw's own controls have no test ids: its canvas and library sidebar are found by its
// class names (SPEC-NOTES.md).

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Browser, Page } from "playwright";
import { browser, clickEditor, login, newNote, notesText, page, startServer, type Server } from "./harness.ts";

let s: Server;
let b: Browser;

before(async () => {
  s = await startServer();
  await s.addUser("dana");
  b = await browser();
});

after(async () => {
  await b?.close();
  await s?.stop();
});

const policyErrors = (errors: string[]) => errors.filter((e) => /Content Security Policy|Refused to/i.test(e));
const ready = (p: Page) => p.locator('[data-testid="drawing"][data-ready="true"]').waitFor({ timeout: 30000 });
const state = (p: Page) => p.getByTestId("save-status").getAttribute("data-state");
const waitState = (p: Page, st: string) => p.locator(`[data-testid="save-status"][data-state="${st}"]`).waitFor();
const doc = async (p: Page) => JSON.parse(await p.evaluate(() => (window as unknown as { __drawing: { text(): string } }).__drawing.text()));
const texts = async (p: Page) => (await doc(p)).elements.filter((e: { type: string }) => e.type === "text").map((e: { originalText: string }) => e.originalText);
const addText = (p: Page, t: string, x = 100, y = 100) => p.evaluate(([t, x, y]) => (window as unknown as { __drawing: { addText(t: string, x: number, y: number): void } }).__drawing.addText(t as string, x as number, y as number), [t, x, y] as const);
const save = async (p: Page) => {
  await p.getByTestId("save").click();
  await waitState(p, "saved");
};

/** A red PNG, and how many clearly red pixels the drawing shows. */
const redPng = (w = 200, h = 150) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 220, g: 20, b: 20 } } }).png().toBuffer();
async function redShown(p: Page): Promise<number> {
  const shot = await p.getByTestId("drawing").screenshot();
  const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
  let red = 0;
  for (let i = 0; i < data.length; i += info.channels) if (data[i] > 180 && data[i + 1] < 70 && data[i + 2] < 70) red++;
  return red;
}
async function addImage(p: Page): Promise<void> {
  const png = (await redPng()).toString("base64");
  await p.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await (window as unknown as { __drawing: { addImage(f: File): Promise<void> } }).__drawing.addImage(new File([bytes], "red.png", { type: "image/png" }));
  }, png);
}

interface Fresh {
  p: Page;
  errors: string[];
  /** Fonts the page itself asked for from another address. */
  foreignFonts: string[];
  close(): Promise<void>;
}
async function fresh(): Promise<Fresh> {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const { page: p, errors } = await page(ctx);
  const foreignFonts: string[] = [];
  p.on("request", (r) => {
    // Only Nook's own page: an embedded web page in its own frame may load what it likes.
    if (r.frame() !== p.mainFrame()) return;
    const font = r.resourceType() === "font" || /\.(woff2?|ttf|otf)(\?|$)/.test(r.url());
    if (font && !r.url().startsWith(s.url)) foreignFonts.push(r.url());
  });
  await login(p, s.url, "dana");
  return { p, errors, foreignFonts, close: () => ctx.close() };
}

async function newDrawing(p: Page): Promise<string> {
  await p.getByTestId("new-drawing").click();
  await ready(p);
  return /\/d\/([a-z2-7]{24})/.exec(p.url())![1];
}

async function userId(name: string): Promise<string> {
  const users = JSON.parse(await fs.readFile(path.join(s.data, "srv", "config", "users.json"), "utf8")).users as { id: string; username: string }[];
  return users.find((u) => u.username === name)!.id;
}

test("create a drawing, add text, save, reload: it is not unsaved; only the background changed is", async () => {
  const f = await fresh();
  const { p } = f;
  const id = await newDrawing(p);
  await p.locator(`[data-testid="note-row"][data-id="${id}"][data-kind="drawing"]`).waitFor();
  assert.equal(await state(p), "saved", "a drawing never opens unsaved");
  await addText(p, "hello drawing");
  await waitState(p, "dirty");
  await save(p);
  await p.reload();
  await ready(p);
  assert.equal(await state(p), "saved", "not unsaved after a reload");
  assert.deepEqual(await texts(p), ["hello drawing"]);
  // Moving the view changes nothing.
  await p.mouse.wheel(0, 300);
  await p.waitForTimeout(400);
  assert.equal(await state(p), "saved");
  await p.evaluate(() => (window as unknown as { __drawing: { setBackground(c: string): void } }).__drawing.setBackground("#ffec99"));
  await waitState(p, "dirty");
  assert.equal((await doc(p)).appState.viewBackgroundColor, "#ffec99");
  assert.deepEqual(policyErrors(f.errors), []);
  assert.deepEqual(f.foreignFonts, []);
  await f.close();
});

test("a change followed at once by leaving asks first", async () => {
  const f = await fresh();
  const { p } = f;
  const id = await newDrawing(p);
  await addText(p, "not yet told");
  // At once: within the 200 ms in which the store may not have been told.
  await p.locator(".brand").click();
  await p.getByTestId("confirm").waitFor();
  await p.getByTestId("cancel").click();
  assert.match(p.url(), new RegExp(`/d/${id}$`));
  assert.deepEqual(await texts(p), ["not yet told"]);
  await f.close();
});

test("an image added, saved, reloaded and seen; Ctrl+S saves to Nook", async () => {
  const f = await fresh();
  const { p } = f;
  await newDrawing(p);
  await addImage(p);
  await waitState(p, "dirty");
  assert.equal(Object.keys((await doc(p)).files).length, 1, "the image is in the file");
  // Ctrl+S, caught before Excalidraw sees it.
  await p.keyboard.press("Control+s");
  await waitState(p, "saved");
  await p.reload();
  await ready(p);
  assert.equal(await state(p), "saved");
  assert.ok((await redShown(p)) > 10000, "the image is drawn");
  assert.deepEqual(policyErrors(f.errors), []);
  assert.deepEqual(f.foreignFonts, []);
  await f.close();
});

test("a scene file with an image loaded from disk, saved and reloaded; the title and tags are kept", async () => {
  const f = await fresh();
  const { p } = f;
  await newDrawing(p);
  await p.getByTestId("tag-input").fill("disk");
  await p.getByTestId("tag-input").press("Enter");
  await save(p);
  const title = await p.getByTestId("note-title").textContent();
  const png = (await redPng()).toString("base64");
  const fileScene = {
    type: "excalidraw",
    version: 2,
    source: "https://excalidraw.com",
    elements: [
      { id: "img1", type: "image", x: 0, y: 0, width: 200, height: 150, angle: 0, strokeColor: "transparent", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, version: 3, versionNonce: 7, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, status: "saved", fileId: "redfile", scale: [1, 1] },
      { id: "txt1", type: "text", x: 0, y: 200, width: 120, height: 25, angle: 0, strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 2, version: 3, versionNonce: 8, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, text: "from disk", fontSize: 20, fontFamily: 5, textAlign: "left", verticalAlign: "top", containerId: null, originalText: "from disk", autoResize: true, lineHeight: 1.25 },
    ],
    appState: { viewBackgroundColor: "#ffffff", gridSize: 20 },
    files: { redfile: { mimeType: "image/png", id: "redfile", dataURL: `data:image/png;base64,${png}`, created: 1 } },
  };
  // Dropped on the canvas, as a person drops the file.
  await p.evaluate(async (json) => {
    const dt = new DataTransfer();
    dt.items.add(new File([json], "scene.excalidraw", { type: "application/json" }));
    const t = document.querySelector("canvas.excalidraw__canvas.interactive")!;
    const r = t.getBoundingClientRect();
    for (const type of ["dragover", "drop"]) t.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 300, clientY: r.top + 300 }));
  }, JSON.stringify(fileScene));
  await p.waitForFunction(() => JSON.parse((window as unknown as { __drawing: { text(): string } }).__drawing.text()).elements.length === 2);
  await waitState(p, "dirty");
  const loaded = await doc(p);
  assert.deepEqual(loaded.nook.tags, ["disk"], "the tags are kept");
  assert.equal(loaded.nook.title, title, "the title is kept");
  await save(p);
  await p.reload();
  await ready(p);
  assert.equal(await state(p), "saved");
  assert.deepEqual(await texts(p), ["from disk"]);
  assert.deepEqual(Object.keys((await doc(p)).files), ["redfile"]);
  assert.ok((await redShown(p)) > 10000, "its image is drawn");
  assert.deepEqual(policyErrors(f.errors), []);
  await f.close();
});

test("a file from excalidraw.com placed in the folder opens with its image, as Untitled with no tags", async () => {
  const uid = await userId("dana");
  const id = "abcdefghijklmnopqrstuvwx";
  const png = (await redPng()).toString("base64");
  const theirs = {
    type: "excalidraw",
    version: 2,
    source: "https://excalidraw.com",
    elements: [{ id: "i", type: "image", x: 10, y: 10, width: 200, height: 150, angle: 0, strokeColor: "transparent", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [], frameId: null, index: "a0", roundness: null, seed: 5, version: 4, versionNonce: 9, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, status: "saved", fileId: "f1", scale: [1, 1], crop: null }],
    appState: { gridSize: 20, gridStep: 5, gridModeEnabled: false, viewBackgroundColor: "#ffffff" },
    files: { f1: { mimeType: "image/png", id: "f1", dataURL: `data:image/png;base64,${png}`, created: 1, lastRetrieved: 1 } },
  };
  const elsewhere = path.join(s.data, "srv", "users", uid, "tmp-by-hand", id);
  await fs.mkdir(elsewhere, { recursive: true });
  await fs.writeFile(path.join(elsewhere, "drawing.excalidraw"), JSON.stringify(theirs, null, 2));
  await fs.rename(elsewhere, path.join(s.data, "srv", "users", uid, "notes", id));
  const f = await fresh();
  const { p } = f;
  const row = p.locator(`[data-testid="note-row"][data-id="${id}"]`);
  await row.waitFor();
  assert.equal(await row.getAttribute("data-kind"), "drawing");
  await row.click();
  await ready(p);
  assert.equal(await p.getByTestId("note-title").textContent(), "Untitled");
  assert.equal(await p.getByTestId("tag").count(), 0);
  assert.equal(await state(p), "saved");
  assert.ok((await redShown(p)) > 10000, "its image is drawn");
  // A save writes Nook's form and keeps the image.
  await addText(p, "mine now");
  await save(p);
  const onDisk = JSON.parse(await fs.readFile(path.join(s.data, "srv", "users", uid, "notes", id, "drawing.excalidraw"), "utf8"));
  assert.equal(onDisk.source, "nook");
  assert.deepEqual(Object.keys(onDisk.files), ["f1"]);
  assert.equal(onDisk.nook.title, "Untitled");
  assert.deepEqual(policyErrors(f.errors), []);
  await f.close();
});

test("a draft opened after a reload", async () => {
  const f = await fresh();
  const { p } = f;
  await newDrawing(p);
  await addText(p, "saved part");
  await save(p);
  await addText(p, "unsaved part", 100, 300);
  await p.waitForTimeout(1000);
  const dialogs: string[] = [];
  p.on("dialog", (d) => {
    dialogs.push(d.type());
    void d.accept();
  });
  await p.reload();
  await ready(p);
  assert.deepEqual(dialogs, ["beforeunload"], "the page asks before it is left");
  assert.deepEqual(await texts(p), ["saved part"]);
  await p.getByTestId("draft-row").waitFor();
  await p.getByTestId("draft-open").click();
  await p.waitForFunction(() => JSON.parse((window as unknown as { __drawing: { text(): string } }).__drawing.text()).elements.length === 2);
  await ready(p);
  assert.deepEqual((await texts(p)).sort(), ["saved part", "unsaved part"]);
  assert.equal(await state(p), "dirty", "an opened draft is unsaved");
  await save(p);
  assert.equal(await p.getByTestId("draft-row").count(), 0);
  assert.deepEqual(policyErrors(f.errors), []);
  await f.close();
});

test("a library item added is still there after a reload", async () => {
  const f = await fresh();
  const { p } = f;
  await newDrawing(p);
  await addText(p, "for the library");
  await p.locator("canvas.excalidraw__canvas.interactive").click({ position: { x: 700, y: 500 } });
  await p.keyboard.press("Control+a");
  await p.locator(".sidebar-trigger").first().click();
  // The pending item pulses, so the click is not waited for stability.
  await p.locator(".library-unit__pulse").first().click({ force: true });
  const uid = await userId("dana");
  await p.waitForFunction((k) => (JSON.parse(localStorage.getItem(k) ?? "[]") as unknown[]).length === 1, `nook:library:${uid}`);
  await p.reload();
  await ready(p);
  assert.equal(await p.evaluate((k) => (JSON.parse(localStorage.getItem(k) ?? "[]") as unknown[]).length, `nook:library:${uid}`), 1);
  await p.locator(".sidebar-trigger").first().click();
  await p.locator(".library-menu-items-container__grid .library-unit").first().waitFor();
  assert.ok((await p.locator(".library-menu-items-container__grid .library-unit").count()) >= 1, "shown in the library");
  assert.deepEqual(policyErrors(f.errors), []);
  await f.close();
});

test("a conflict in two tabs: Keep mine, then Take theirs keeps the scene as a draft", async () => {
  const one = await fresh();
  const id = await newDrawing(one.p);
  await addText(one.p, "first");
  await save(one.p);
  const two = await fresh();
  await two.p.goto(`${s.url}/d/${id}`);
  await ready(two.p);
  await addText(two.p, "from two", 100, 200);
  await save(two.p);
  // Tab one saves from the old revision: 409, its drawing is kept.
  await addText(one.p, "from one", 100, 300);
  await one.p.getByTestId("save").click();
  await one.p.getByTestId("conflict-mine").waitFor();
  assert.equal(await state(one.p), "error");
  assert.deepEqual((await texts(one.p)).sort(), ["first", "from one"]);
  await one.p.getByTestId("conflict-mine").click();
  await waitState(one.p, "saved");
  // Now tab two is behind: Take theirs loads tab one's drawing and keeps its own as a draft.
  await addText(two.p, "two again", 100, 400);
  await two.p.getByTestId("save").click();
  await two.p.getByTestId("conflict-theirs").click();
  await two.p.waitForFunction(() => {
    const t = JSON.parse((window as unknown as { __drawing: { text(): string } }).__drawing.text());
    return t.elements.some((e: { originalText?: string }) => e.originalText === "from one");
  });
  await ready(two.p);
  assert.deepEqual((await texts(two.p)).sort(), ["first", "from one"]);
  assert.equal(await state(two.p), "saved");
  await two.p.reload();
  await ready(two.p);
  await two.p.getByTestId("draft-row").first().waitFor();
  await two.p.getByTestId("draft-open").first().click();
  await two.p.waitForFunction(() => JSON.parse((window as unknown as { __drawing: { text(): string } }).__drawing.text()).elements.length === 3);
  assert.deepEqual((await texts(two.p)).sort(), ["first", "from two", "two again"]);
  assert.deepEqual([...policyErrors(one.errors), ...policyErrors(two.errors)], []);
  await one.close();
  await two.close();
});

test("trash and restore a drawing", async () => {
  const f = await fresh();
  const { p } = f;
  const id = await newDrawing(p);
  await addText(p, "to the trash");
  await save(p);
  await p.getByTestId("note-trash").click();
  await p.locator(`[data-testid="note-row"][data-id="${id}"]`).waitFor({ state: "detached" });
  await p.getByTestId("nav-trash").click();
  const row = p.locator(`[data-testid="trash-row"][data-id="${id}"]`);
  await row.waitFor();
  assert.equal(await row.getAttribute("data-kind"), "drawing");
  assert.match((await row.textContent()) ?? "", /Drawing/);
  await row.getByTestId("trash-restore").click();
  await row.waitFor({ state: "detached" });
  await p.goto(`${s.url}/d/${id}`);
  await ready(p);
  assert.deepEqual(await texts(p), ["to the trash"]);
  assert.deepEqual(policyErrors(f.errors), []);
  await f.close();
});

test("history and restore of a drawing", async () => {
  const f = await fresh();
  const { p } = f;
  const id = await newDrawing(p);
  await addText(p, "version one");
  await save(p);
  await addText(p, "version two", 100, 300);
  await save(p);
  await p.getByTestId("note-history").click();
  await p.getByTestId("history-row").nth(1).waitFor();
  assert.equal(await p.getByTestId("history-row").count(), 2);
  // The newest version holds the drawing before the last save: "version one" only.
  await p.getByTestId("history-row").first().click();
  await ready(p);
  await p.getByTestId("history-restore").click();
  await p.waitForURL(new RegExp(`/d/${id}$`));
  await ready(p);
  assert.deepEqual(await texts(p), ["version one"]);
  assert.equal(await state(p), "saved");
  await p.getByTestId("note-history").click();
  await p.getByTestId("history-row").nth(2).waitFor();
  assert.equal(await p.getByTestId("history-row").count(), 3, "the restore is a save, so it is in history too");
  assert.deepEqual(policyErrors(f.errors), []);
  await f.close();
});

test("a drawing and a note in turn both keep working; a wrong-kind address goes to the right one", async () => {
  const f = await fresh();
  const { p } = f;
  const noteId = await newNote(p);
  await clickEditor(p);
  await p.keyboard.type("A note beside a drawing");
  await p.getByTestId("save").click();
  await waitState(p, "saved");
  const drawingId = await newDrawing(p);
  await addText(p, "drawn");
  await save(p);
  await p.locator(`[data-testid="note-row"][data-id="${noteId}"]`).click();
  await p.getByTestId("editor").waitFor();
  await p.waitForFunction(() => (window as unknown as { __notes?: unknown }).__notes !== undefined);
  assert.match(await notesText(p), /A note beside a drawing$/);
  await clickEditor(p);
  await p.keyboard.type(" again");
  await p.getByTestId("save").click();
  await waitState(p, "saved");
  await p.locator(`[data-testid="note-row"][data-id="${drawingId}"]`).click();
  await ready(p);
  assert.deepEqual(await texts(p), ["drawn"]);
  await addText(p, "drawn again", 100, 300);
  await save(p);
  await p.locator(`[data-testid="note-row"][data-id="${noteId}"]`).click();
  await p.waitForFunction(() => (window as unknown as { __notes?: { text(): string } }).__notes?.text().endsWith("again") === true);
  // A drawing's id under /n/ (and a note's under /d/) goes to the right address.
  await p.goto(`${s.url}/n/${drawingId}`);
  await ready(p);
  assert.match(p.url(), new RegExp(`/d/${drawingId}$`));
  await p.goto(`${s.url}/d/${noteId}`);
  await p.getByTestId("editor").waitFor();
  assert.match(p.url(), new RegExp(`/n/${noteId}$`));
  assert.deepEqual(policyErrors(f.errors), []);
  assert.deepEqual(f.foreignFonts, []);
  await f.close();
});

test("opening a note requests no Excalidraw file; opening a drawing asks no font of another address", async () => {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const { page: p, errors } = await page(ctx);
  const asked: string[] = [];
  p.on("request", (r) => asked.push(r.url()));
  await login(p, s.url, "dana");
  await newNote(p);
  await clickEditor(p);
  await p.keyboard.type("only a note");
  await p.getByTestId("save").click();
  await waitState(p, "saved");
  await p.waitForTimeout(500);
  const excalidraw = asked.filter((u) => /\/assets\/(mount-|excalidraw\/)|excalidraw/i.test(u));
  assert.deepEqual(excalidraw, [], "a note downloads nothing of Excalidraw");
  // Now a drawing with text (in Excalifont, Excalidraw's own): every font from Nook.
  await newDrawing(p);
  await addText(p, "fonts");
  await p.waitForTimeout(1000);
  const fonts = asked.filter((u) => /\.(woff2?|ttf|otf)(\?|$)/.test(u));
  assert.ok(fonts.some((u) => u.includes("/assets/excalidraw/fonts/")), "Excalidraw's fonts come from /assets/excalidraw/fonts/");
  assert.deepEqual(fonts.filter((u) => !u.startsWith(s.url)), [], "no font from another address");
  assert.ok(asked.some((u) => /\/assets\/mount-[^/]+\.css$/.test(u)), "Excalidraw's CSS is its own file, loaded now");
  assert.deepEqual(policyErrors(errors), []);
  await ctx.close();
});
