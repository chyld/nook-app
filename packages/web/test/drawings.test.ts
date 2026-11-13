// SPEC-DRAWINGS 8, `web` stores: a drawing through the `editor` store with a fake view: save with
// the right type, 409, a queued save, a draft with its kind and without image data, save as new
// of a gone drawing; a note still saves as Markdown. In Node with a fake API client.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setClient } from "../src/lib/api.ts";
import { editor, DRAFT_DELAY, type ViewHandle } from "../src/stores/editor.svelte.ts";
import { drafts } from "../src/stores/drafts.svelte.ts";
import { session } from "../src/stores/session.svelte.ts";
import { emptyDrawing, serializeDrawing, type DrawingScene } from "../../core/src/index.ts";
import { FakeApi, FakeStorage, rev } from "./fake.ts";

let api: FakeApi;
let storage: FakeStorage;
const tick = () => new Promise((r) => setTimeout(r, 0));

const rect = (id: string, version = 1) => ({ type: "rectangle", id, version, x: 0, y: 0, width: 5, height: 5, isDeleted: false });
const image = (id: string, fileId: string) => ({ type: "image", id, version: 1, fileId, status: "saved", isDeleted: false });
const png = (id: string) => ({ id, mimeType: "image/png", dataURL: `data:image/png;base64,${id}` });
const nook = { title: "Sketch", tags: ["art"], created: "2026-11-12" };

/** A fake drawing view: the scene as "Excalidraw" has it, changed by the test. */
let screen: DrawingScene = { elements: [], appState: {}, files: {} };
let loads = 0;
const view: ViewHandle = {
  getText: () => editor.drawingText(),
  setText: () => {},
  scene: () => screen,
  load: async (sc) => {
    loads++;
    screen = { elements: [...sc.elements], appState: { ...sc.appState }, files: { ...sc.files } };
  },
};

beforeEach(async () => {
  api = new FakeApi();
  setClient(api.client());
  storage = new FakeStorage();
  drafts.useStorage(storage);
  loads = 0;
  await session.login("alice", "x");
});

async function openDrawing(text: string): Promise<string> {
  const id = api.add(text, "drawing");
  await editor.open(id, "drawing");
  const doc = JSON.parse(editor.loadedText);
  screen = { elements: doc.elements, appState: { ...doc.appState, scrollX: 0, zoom: { value: 1 } }, files: doc.files };
  editor.register(view);
  return id;
}

const change = (sc: Partial<DrawingScene>) => {
  screen = { ...screen, ...sc };
  editor.changed();
};

test("a drawing opens saved; moving the view changes nothing; a change makes it unsaved", async () => {
  await openDrawing(serializeDrawing({ elements: [rect("a")], appState: { viewBackgroundColor: "#fff" }, files: {} }, nook));
  assert.equal(editor.kind, "drawing");
  assert.equal(editor.saveState, "saved");
  assert.deepEqual(editor.nook, nook);
  change({ appState: { ...screen.appState, scrollX: 500, zoom: { value: 3 }, selectedElementIds: { a: true } } });
  assert.equal(editor.saveState, "saved", "the view, the zoom and the selection are not in the signature");
  change({ elements: [rect("a", 2)] });
  assert.equal(editor.saveState, "dirty");
  change({ elements: [rect("a", 1)] });
  assert.equal(editor.saveState, "saved", "the same versions again");
  change({ appState: { ...screen.appState, viewBackgroundColor: "#000" } });
  assert.equal(editor.saveState, "dirty", "only the background");
});

test("save: the whole file with the drawing type and the base revision; back to saved", async () => {
  const start = serializeDrawing({ elements: [image("i", "f1")], appState: { viewBackgroundColor: "#fff" }, files: { f1: png("f1") } }, nook);
  const id = await openDrawing(start);
  change({ elements: [image("i", "f1"), rect("r")] });
  editor.setNook({ tags: ["art", "plan"] });
  await editor.save();
  assert.equal(api.saves.length, 1);
  assert.equal(api.saves[0].kind, "drawing", "sent as a drawing");
  assert.equal(api.saves[0].base, rev(start));
  const sent = JSON.parse(api.saves[0].text);
  assert.deepEqual(sent.files, { f1: png("f1") }, "images inside the file");
  assert.deepEqual(sent.nook, { ...nook, tags: ["art", "plan"] });
  assert.equal(sent.appState.scrollX, undefined, "the view is not saved");
  assert.equal(editor.base, rev(api.saves[0].text));
  assert.equal(editor.saveState, "saved");
  assert.equal(api.notes.get(id)!.text, api.saves[0].text);
});

test("the title and tags make a drawing unsaved until Save", async () => {
  await openDrawing(emptyDrawing("Untitled 1", "2026-11-12"));
  editor.setNook({ title: "Garden" });
  assert.equal(editor.saveState, "dirty");
  await editor.save();
  assert.equal(JSON.parse(api.saves[0].text).nook.title, "Garden");
  assert.equal(editor.saveState, "saved");
});

test("409: the drawing is kept; Take theirs keeps the person's scene as a draft without images and loads theirs", async () => {
  const start = serializeDrawing({ elements: [rect("a")], appState: {}, files: {} }, nook);
  const id = await openDrawing(start);
  const theirs = serializeDrawing({ elements: [rect("t", 5)], appState: { viewBackgroundColor: "#eee" }, files: {} }, { ...nook, title: "Theirs" });
  api.notes.get(id)!.text = theirs;
  change({ elements: [rect("a"), image("m", "fm")], files: { fm: png("fm") } });
  await editor.save();
  assert.equal(editor.conflict?.kind, "changed");
  assert.equal(editor.saveState, "error");
  await editor.takeTheirs();
  assert.equal(loads, 1, "theirs loaded into the view");
  assert.deepEqual(screen.elements, [rect("t", 5)]);
  assert.equal(editor.nook.title, "Theirs");
  assert.equal(editor.saveState, "saved", "the baseline taken after Take theirs");
  assert.equal(editor.base, rev(theirs));
  const kept = drafts.list("uuuuuuuuuuuuuuuu");
  assert.equal(kept.length, 1);
  assert.equal(kept[0].kind, "drawing");
  const d = JSON.parse(kept[0].text);
  assert.deepEqual(d.files, {}, "a draft holds no image data");
  assert.deepEqual(d.elements.map((e: { id: string }) => e.id), ["a", "m"]);
});

test("Keep mine saves again from the newer revision, as a drawing", async () => {
  const id = await openDrawing(emptyDrawing("D", "2026-11-12"));
  const theirs = emptyDrawing("Theirs", "2026-11-12");
  api.notes.get(id)!.text = theirs;
  change({ elements: [rect("a")] });
  await editor.save();
  await editor.keepMine();
  assert.equal(api.saves.length, 2);
  assert.equal(api.saves[1].base, rev(theirs));
  assert.equal(api.saves[1].kind, "drawing");
  assert.equal(editor.saveState, "saved");
});

test("a save while one is out is queued, at most one; the queued one sends the newest scene", async () => {
  await openDrawing(emptyDrawing("D", "2026-11-12"));
  let open!: () => void;
  api.gate = new Promise((r) => (open = r));
  change({ elements: [rect("a")] });
  const first = editor.save();
  change({ elements: [rect("a"), rect("b")] });
  void editor.save();
  void editor.save();
  assert.equal(editor.queued, true);
  api.gate = null;
  open();
  await first;
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(api.saves.length, 2, "one queued save");
  assert.deepEqual(JSON.parse(api.saves[1].text).elements.map((e: { id: string }) => e.id), ["a", "b"]);
  assert.equal(editor.saveState, "saved");
});

test("a draft: stored with its kind and without image data, a moment after a change; removed after a save", async () => {
  const id = await openDrawing(serializeDrawing({ elements: [image("i", "f1")], appState: {}, files: { f1: png("f1") } }, nook));
  change({ elements: [image("i", "f1"), rect("r")] });
  await new Promise((r) => setTimeout(r, DRAFT_DELAY + 50));
  const d = drafts.get("uuuuuuuuuuuuuuuu", id, editor.editorId)!;
  assert.ok(d, "stored");
  assert.equal(d.kind, "drawing");
  assert.deepEqual(JSON.parse(d.text).files, {}, "no image data");
  assert.equal(JSON.parse(d.text).elements.length, 2);
  assert.equal(JSON.parse(storage.getItem(d.key)!).kind, "drawing");
  await editor.save();
  assert.equal(drafts.get("uuuuuuuuuuuuuuuu", id, editor.editorId), null, "removed once saved");
});

test("a stored draft without a kind is a note's; a drawing is offered only its own drafts", async () => {
  storage.setItem("notes:draft:uuuuuuuuuuuuuuuu:aaaaaaaaaaaaaaaaaaaaaaaa:eeeeeeeeeeeeeeee", JSON.stringify({ text: "x", base: "b", time: 1 }));
  assert.equal(drafts.list("uuuuuuuuuuuuuuuu")[0].kind, "note");
  const id = await openDrawing(emptyDrawing("D", "2026-11-12"));
  drafts.put("uuuuuuuuuuuuuuuu", id, "ffffffffffffffff", "# a note's text", "b", 2, "note");
  drafts.put("uuuuuuuuuuuuuuuu", id, "gggggggggggggggg", emptyDrawing("D", "2026-11-12"), "b", 3, "drawing");
  editor.close();
  await editor.open(id, "drawing");
  assert.deepEqual(editor.offered.map((d) => d.editorId), ["gggggggggggggggg"]);
});

test("opening a draft: the scene from the draft, the images from the file read; the drawing is then unsaved", async () => {
  const start = serializeDrawing({ elements: [image("i1", "f1")], appState: { viewBackgroundColor: "#fff" }, files: { f1: png("f1") } }, nook);
  const id = api.add(start, "drawing");
  const draft = serializeDrawing({ elements: [image("i1", "f1"), image("i2", "f2"), rect("r")], appState: { viewBackgroundColor: "#ff0" }, files: {} }, { ...nook, title: "Drafted" });
  drafts.put("uuuuuuuuuuuuuuuu", id, "hhhhhhhhhhhhhhhh", draft, rev(start), 5, "drawing");
  await editor.open(id, "drawing");
  const doc = JSON.parse(editor.loadedText);
  screen = { elements: doc.elements, appState: doc.appState, files: doc.files };
  editor.register(view);
  assert.equal(editor.offered.length, 1);
  await editor.openDraft(editor.offered[0]);
  assert.deepEqual(screen.elements.map((e) => (e as { id: string }).id), ["i1", "i2", "r"]);
  assert.deepEqual(screen.files, { f1: png("f1") }, "f1 from the file; f2 is not anywhere");
  assert.equal(screen.appState.viewBackgroundColor, "#ff0");
  assert.equal(editor.nook.title, "Drafted");
  assert.equal(editor.saveState, "dirty", "opening a draft leaves the baseline alone");
  assert.equal(editor.offered.length, 0);
});

test("410: Save as a new drawing sends the whole drawing with ?from and the drawing kind", async () => {
  const id = await openDrawing(serializeDrawing({ elements: [image("i", "f1")], appState: {}, files: { f1: png("f1") } }, nook));
  api.notes.get(id)!.trashed = true;
  change({ elements: [image("i", "f1"), rect("r")] });
  await editor.save();
  assert.deepEqual(editor.conflict, { kind: "gone", status: 410 });
  const nid = await editor.saveAsNew();
  assert.ok(nid);
  assert.equal(api.asNew.length, 1);
  assert.equal(api.asNew[0].kind, "drawing");
  assert.equal(api.asNew[0].from, id);
  assert.deepEqual(JSON.parse(api.asNew[0].text).files, { f1: png("f1") }, "the open drawing has its images");
  assert.equal(api.notes.get(nid!)!.kind, "drawing");
});

test("save as new of a gone drawing's draft (the home screen): the draft, its kind and the source", async () => {
  const draft = serializeDrawing({ elements: [image("i", "f1")], appState: {}, files: {} }, nook);
  editor.close();
  const nid = await editor.saveAsNew(draft, "zzzzzzzzzzzzzzzzzzzzzzzz", "drawing");
  assert.ok(nid);
  assert.deepEqual(api.asNew[0], { text: draft, from: "zzzzzzzzzzzzzzzzzzzzzzzz", kind: "drawing" });
});

test("a note still saves as Markdown, with no drawing type", async () => {
  const id = api.add("one\n");
  await editor.open(id, "note");
  let text = editor.loadedText;
  editor.register({ getText: () => text, setText: (t) => (text = t) });
  assert.equal(editor.kind, "note");
  text = "one two\n";
  editor.changed();
  await editor.save();
  assert.deepEqual(api.saves[0], { id, text: "one two\n", base: rev("one\n") });
  const nid = await editor.saveAsNew();
  assert.equal(api.asNew[0].kind, "note");
  assert.equal(api.notes.get(nid!)!.kind, undefined);
});
