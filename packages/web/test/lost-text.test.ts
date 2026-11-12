// Findings of section 1 of the version 2 code review (lost text), at the level of the stores: in
// Node, with the fake API client. Each test names its finding.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setClient } from "../src/lib/api.ts";
import { editor } from "../src/stores/editor.svelte.ts";
import { drafts } from "../src/stores/drafts.svelte.ts";
import { session } from "../src/stores/session.svelte.ts";
import { toasts } from "../src/stores/toasts.svelte.ts";
import { FakeApi, FakeStorage, rev } from "./fake.ts";

const U = "uuuuuuuuuuuuuuuu";
let api: FakeApi;
let storage: FakeStorage;
let screen = "";
/** What a focused table cell holds and the note does not yet (7.7): written by `flush`. */
let cell = "";
const view = {
  getText: () => screen,
  setText: (t: string) => (screen = t),
  flush: () => {
    if (!cell) return;
    screen = screen.replace("|  |", `| ${cell} |`);
    cell = "";
    editor.changed();
  },
};
const TABLE = "top\n\n| a |\n|---|\n|  |\n";

beforeEach(async () => {
  api = new FakeApi();
  setClient(api.client());
  storage = new FakeStorage();
  drafts.useStorage(storage);
  cell = "";
  toasts.answer(false);
  await session.login("alice", "x");
});

async function open(text: string): Promise<string> {
  const id = api.add(text);
  await editor.open(id);
  screen = editor.loadedText;
  editor.register(view);
  return id;
}

const typedInCell = async () => {
  const id = await open(TABLE);
  cell = "hello";
  return id;
};
const withHello = /\| hello \|/;

test("1: Save writes a focused table cell first", async () => {
  const id = await typedInCell();
  await editor.save();
  assert.match(api.notes.get(id)!.text, withHello);
});

test("1: leaving the note (Back, another screen, New note, Move to trash) sees a focused cell's text as unsaved", async () => {
  await typedInCell();
  assert.equal(editor.dirty, false, "the note's text itself is unchanged");
  assert.equal(editor.unsaved(), true);
  assert.match(screen, withHello);
});

test("1: closing or reloading the page stores the draft with a focused cell's text, and does not remove it", async () => {
  const id = await typedInCell();
  const editorId = editor.editorId;
  editor.flushDraft();
  assert.match(drafts.get(U, id, editorId)?.text ?? "", withHello);
});

test("1: leaving the editor screen (close) stores the draft with a focused cell's text", async () => {
  const id = await typedInCell();
  const editorId = editor.editorId;
  editor.close();
  assert.match(drafts.get(U, id, editorId)?.text ?? "", withHello);
});

test("1: Take theirs and Save as a new note take a focused cell's text", async () => {
  const id = await open(TABLE);
  api.notes.get(id)!.text = "theirs\n";
  screen = screen.replace("top", "mine");
  editor.changed();
  await editor.save();
  assert.equal(editor.conflict?.kind, "changed");
  cell = "hello";
  await editor.takeTheirs();
  assert.match(editor.rescued ?? "", withHello);

  const id2 = await open(TABLE);
  api.notes.get(id2)!.trashed = true;
  screen = screen.replace("top", "mine");
  editor.changed();
  await editor.save();
  cell = "hello";
  const nid = await editor.saveAsNew();
  assert.match(api.notes.get(nid!)!.text, withHello);
});

test("4: Take theirs with the browser's storage full keeps the draft stored before", async () => {
  const id = await open("base\n");
  const editorId = editor.editorId;
  screen = "mine, early\n";
  editor.changed();
  editor.flushDraft();
  assert.equal(drafts.get(U, id, editorId)?.text, "mine, early\n");
  api.notes.get(id)!.text = "theirs\n";
  screen = "mine, later\n";
  editor.changed();
  await editor.save();
  storage.full = true;
  await editor.takeTheirs();
  assert.equal(screen, "theirs\n");
  assert.equal(editor.rescued, "mine, later\n", "the box shows the text");
  assert.equal(drafts.full, true, "the warning is on screen");
  // The draft stored before is still there, and the editor's later work does not remove it.
  editor.flushDraft();
  const kept = drafts.list(U).filter((d) => d.noteId === id);
  assert.deepEqual(kept.map((d) => d.text), ["mine, early\n"]);
});

test("4: Take theirs when the newer text cannot be read keeps the person's text and says so", async () => {
  const id = await open("base\n");
  api.notes.get(id)!.text = "theirs\n";
  screen = "mine\n";
  editor.changed();
  await editor.save();
  // The 409 carried no current text, and the read fails.
  (editor.conflict as { current: unknown }).current = null;
  api.notes.delete(id);
  const before = toasts.list.length;
  await editor.takeTheirs();
  assert.equal(screen, "mine\n");
  assert.equal(editor.conflict?.kind, "changed", "the choice is still offered");
  assert.ok(toasts.list.length > before, "a message says why");
});

test("5: opening an offered draft after typing new text asks first; on OK the new text is kept as a draft", async () => {
  const id = await open("start\n");
  const first = editor.editorId;
  screen = "other tab\n";
  editor.changed();
  editor.flushDraft();
  await editor.open(id);
  screen = editor.loadedText;
  editor.register(view);
  const d = editor.offered[0];
  assert.equal(d.editorId, first);
  screen = "typed here\n";
  editor.changed();
  editor.flushDraft();

  // Cancel: nothing changes.
  const asked = editor.openDraft(d);
  assert.ok(toasts.asking, "a question is asked");
  toasts.answer(false);
  await asked;
  assert.equal(screen, "typed here\n");
  assert.equal(drafts.get(U, id, editor.editorId)?.text, "typed here\n");

  // OK: the draft opens, and the text typed here is kept as another draft.
  const ok = editor.openDraft(d);
  toasts.answer(true);
  await ok;
  assert.equal(screen, "other tab\n");
  const texts = drafts.list(U).filter((x) => x.noteId === id).map((x) => x.text).sort();
  assert.deepEqual(texts, ["other tab\n", "typed here\n"]);
});

test("5: opening an offered draft with nothing typed asks nothing", async () => {
  const id = await open("start\n");
  screen = "other tab\n";
  editor.changed();
  editor.flushDraft();
  await editor.open(id);
  screen = editor.loadedText;
  editor.register(view);
  await editor.openDraft(editor.offered[0]);
  assert.equal(toasts.asking, null);
  assert.equal(screen, "other tab\n");
});

test("6: Save as a new note, then typing while it is out: the later text goes with the new note as its draft", async () => {
  const id = await open("x\n");
  const editorId = editor.editorId;
  api.notes.get(id)!.trashed = true;
  screen = "sent\n";
  editor.changed();
  await editor.save();
  const pending = editor.saveAsNew();
  screen = "sent, and more\n";
  editor.changed();
  const nid = await pending;
  assert.ok(nid);
  assert.equal(api.notes.get(nid!)!.text, "sent\n");
  const forNew = drafts.list(U).filter((d) => d.noteId === nid);
  assert.deepEqual(forNew.map((d) => [d.text, d.base]), [["sent, and more\n", rev("sent\n")]]);
  assert.equal(drafts.get(U, id, editorId), null, "the old note's draft goes once its text is kept");
});

test("7: with no local storage at all, the warning is shown", async () => {
  drafts.useStorage(null);
  const saved = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => undefined });
  try {
    assert.equal(drafts.put(U, "n".repeat(24), "e".repeat(16), "t", "r"), false);
    assert.equal(drafts.full, true);
  } finally {
    if (saved) Object.defineProperty(globalThis, "localStorage", saved);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
    drafts.useStorage(storage);
  }
});

test("8: a draft with CRLF or a byte order mark whose text equals the saved note's is not 'Saved'", async () => {
  for (const bytes of ["a\r\nb\r\n", "﻿a\nb\n"]) {
    const id = await open("a\nb\n");
    const other = drafts.newEditorId();
    drafts.put(U, id, other, bytes, rev("a\nb\n"));
    await editor.open(id);
    screen = editor.loadedText;
    editor.register(view);
    const d = editor.offered.find((x) => x.editorId === other)!;
    await editor.openDraft(d);
    assert.equal(screen, "a\nb\n");
    assert.equal(editor.dirty, true, JSON.stringify(bytes));
    assert.equal(editor.saveState, "dirty");
    editor.flushDraft();
    assert.equal(drafts.get(U, id, editor.editorId)?.text, bytes, "the draft is kept");
    await editor.save();
    assert.equal(api.notes.get(id)!.text, bytes);
    assert.equal(editor.saveState, "saved");
  }
});

// --- 9a, 30: the history screen's picked version (the `library` store) ---

import { library } from "../src/stores/library.svelte.ts";
import type { ApiClient } from "../src/lib/api.ts";
import { ApiError } from "../src/lib/api.ts";

/** A client whose version reads answer when told to, or fail. */
function versionsClient(): { client: ApiClient; answer(v: string, text: string): void; fail(v: string): void } {
  const waiting = new Map<string, { ok: (x: { text: string }) => void; no: (e: Error) => void }>();
  const client: ApiClient = {
    ...api.client(),
    history: async () => ({ versions: [] }),
    version: (_id, v) => new Promise((ok, no) => waiting.set(v, { ok, no })),
  };
  return {
    client,
    answer: (v, text) => waiting.get(v)!.ok({ text }),
    fail: (v) => waiting.get(v)!.no(new ApiError(500, "x", "the disk is on fire")),
  };
}

test("9a: when reading a version fails, there is no text to restore", async () => {
  const c = versionsClient();
  setClient(c.client);
  const id = "n".repeat(24);
  await library.loadHistory(id);
  const p = library.pickVersion(id, "v1");
  assert.equal(library.pickedText, null, "nothing to restore while it is read");
  c.fail("v1");
  await assert.rejects(p);
  assert.equal(library.pickedText, null);
  assert.equal(library.picked, null);
});

test("30: a slow answer for one version is not shown under another", async () => {
  const c = versionsClient();
  setClient(c.client);
  const id = "n".repeat(24);
  await library.loadHistory(id);
  const one = library.pickVersion(id, "v1");
  const two = library.pickVersion(id, "v2");
  c.answer("v2", "two");
  await two;
  c.answer("v1", "one");
  await one;
  assert.equal(library.picked, "v2");
  assert.equal(library.pickedText, "two");
});

// --- 9b: a draft whose note is hidden by the search or tag filter is not "gone" ---

test("9b: a draft's note missing from a narrowed list is looked up, not called gone", async () => {
  const live = api.add("live\n");
  const gone = api.add("gone\n");
  api.notes.delete(gone);
  // The server's list, narrowed by a tag no note has, is empty.
  setClient({ ...api.client(), list: async (q) => ({ entries: q?.tag || q?.q ? [] : [...api.notes.keys()].map((id) => api.entry(id)), tags: [] }) });
  library.reset();
  await library.refresh();
  assert.equal(library.noteStatus(live), "live");
  assert.equal(library.noteStatus(gone), "gone", "the whole list does not have it");
  library.setTag("nothing");
  await library.refresh();
  assert.equal(library.entries.length, 0);
  assert.notEqual(library.noteStatus(live), "gone", "hidden by the filter is not gone");
  await library.lookup(live);
  await library.lookup(gone);
  assert.equal(library.noteStatus(live), "live");
  assert.equal(library.titleOf(live), "T");
  assert.equal(library.noteStatus(gone), "gone");
  library.reset();
});

// --- 28: Save during a conflict, and a failed read in Keep mine ---

test("28: Save while a conflict is showing says why nothing was saved", async () => {
  const id = await open("base\n");
  api.notes.get(id)!.text = "theirs\n";
  screen = "mine\n";
  editor.changed();
  await editor.save();
  const before = toasts.list.length;
  await editor.save();
  assert.equal(api.saves.length, 1);
  assert.ok(toasts.list.slice(before).some((t) => /Keep mine|Take theirs/.test(t.message)), "a message names the choice");
  // A note that is gone: the message names Save as a new note.
  const id2 = await open("x\n");
  api.notes.get(id2)!.trashed = true;
  screen = "y\n";
  editor.changed();
  await editor.save();
  const n = toasts.list.length;
  await editor.save();
  assert.ok(toasts.list.slice(n).some((t) => /Save as a new note/.test(t.message)));
});

test("28: Keep mine when the newer revision cannot be read says so, and the choice stays", async () => {
  const id = await open("base\n");
  api.notes.get(id)!.text = "theirs\n";
  screen = "mine\n";
  editor.changed();
  await editor.save();
  (editor.conflict as { current: unknown }).current = null;
  api.notes.delete(id);
  const before = toasts.list.length;
  await editor.keepMine();
  assert.equal(editor.conflict?.kind, "changed");
  assert.ok(toasts.list.length > before, "a message says why");
  assert.equal(screen, "mine\n");
});
