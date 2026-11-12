// SPEC2 12, `web` stores: save, 409, 410, a save in flight, a queued save, drafts across two
// editors, storage full. In Node with a fake API client.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setClient } from "../src/lib/api.ts";
import { editor, DRAFT_DELAY } from "../src/stores/editor.svelte.ts";
import { drafts } from "../src/stores/drafts.svelte.ts";
import { session } from "../src/stores/session.svelte.ts";
import { FakeApi, FakeStorage, rev } from "./fake.ts";

let api: FakeApi;
let storage: FakeStorage;
let screen = "";
const view = { getText: () => screen, setText: (t: string) => (screen = t) };
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  api = new FakeApi();
  setClient(api.client());
  storage = new FakeStorage();
  drafts.useStorage(storage);
  await session.login("alice", "x");
});

async function open(text: string): Promise<string> {
  const id = api.add(text);
  await editor.open(id);
  screen = editor.loadedText;
  editor.register(view);
  return id;
}

test("save: sends the bytes with the base revision; dirty goes back to saved", async () => {
  const id = await open("one\n");
  assert.equal(editor.saveState, "saved");
  screen = "one two\n";
  editor.changed();
  assert.equal(editor.dirty, true);
  assert.equal(editor.saveState, "dirty");
  await editor.save();
  assert.deepEqual(api.saves[0], { id, text: "one two\n", base: rev("one\n") });
  assert.equal(editor.base, rev("one two\n"));
  assert.equal(editor.saveState, "saved");
});

test("save keeps CRLF and a byte order mark: the bytes go back as they came", async () => {
  await open("\ufeffa\r\nb\r\n");
  assert.equal(editor.loadedText, "a\nb\n");
  screen = "a\nb\nc\n";
  editor.changed();
  await editor.save();
  assert.equal(api.saves[0].text, "\ufeffa\r\nb\r\nc\r\n");
});

test("409: the text is kept and the two choices are offered; Keep mine saves from the newer revision", async () => {
  const id = await open("base\n");
  api.notes.get(id)!.text = "theirs\n";
  screen = "mine\n";
  editor.changed();
  await editor.save();
  assert.equal(editor.conflict?.kind, "changed");
  assert.equal(editor.saveState, "error");
  assert.equal(screen, "mine\n");
  await editor.keepMine();
  assert.equal(api.notes.get(id)!.text, "mine\n");
  assert.equal(editor.conflict, null);
});

test("409: Take theirs loads the newer text and first stores mine as a draft", async () => {
  const id = await open("base\n");
  api.notes.get(id)!.text = "theirs\n";
  screen = "mine\n";
  editor.changed();
  await editor.save();
  await editor.takeTheirs();
  assert.equal(screen, "theirs\n");
  assert.equal(editor.rescued, "mine\n");
  assert.equal(editor.dirty, false);
  const kept = drafts.list("uuuuuuuuuuuuuuuu").filter((d) => d.noteId === id);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].text, "mine\n");
});

test("410 and 404: the text is kept and Save as a new note is offered", async () => {
  const id = await open("x\n");
  api.notes.get(id)!.trashed = true;
  screen = "x y\n";
  editor.changed();
  await editor.save();
  assert.deepEqual(editor.conflict, { kind: "gone", status: 410 });
  const nid = await editor.saveAsNew();
  assert.ok(nid);
  assert.equal(api.notes.get(nid!)!.text, "x y\n");
  const id2 = await open("y\n");
  api.notes.delete(id2);
  screen = "z\n";
  editor.changed();
  await editor.save();
  assert.deepEqual(editor.conflict, { kind: "gone", status: 404 });
});

test("one save at a time: a Save pressed meanwhile is queued, at most one, and sent with the new revision", async () => {
  const id = await open("a\n");
  let release!: () => void;
  api.gate = new Promise((r) => (release = r));
  screen = "a b\n";
  editor.changed();
  const first = editor.save();
  assert.equal(editor.saving, true);
  assert.equal(editor.saveState, "saving");
  screen = "a b c\n";
  editor.changed();
  void editor.save();
  void editor.save();
  assert.equal(editor.queued, true);
  assert.equal(api.saves.length, 1, "the second is not sent while the first is in flight");
  api.gate = null;
  release();
  await first;
  await tick();
  assert.equal(api.saves.length, 2, "at most one queued");
  assert.equal(api.saves[1].base, rev("a b\n"), "sent with the revision from the first answer");
  assert.equal(api.notes.get(id)!.text, "a b c\n");
});

test("a queued save is dropped on a 409", async () => {
  const id = await open("a\n");
  let release!: () => void;
  api.gate = new Promise((r) => (release = r));
  api.notes.get(id)!.text = "elsewhere\n";
  screen = "mine\n";
  editor.changed();
  const first = editor.save();
  void editor.save();
  api.gate = null;
  release();
  await first;
  await tick();
  assert.equal(api.saves.length, 1);
  assert.equal(editor.queued, false);
  assert.equal(editor.conflict?.kind, "changed");
});

test("a late answer for a note the person has left changes nothing on screen but removes that editor's draft", async () => {
  const id = await open("a\n");
  const editorId = editor.editorId;
  let release!: () => void;
  api.gate = new Promise((r) => (release = r));
  screen = "a late\n";
  editor.changed();
  editor.flushDraft();
  assert.ok(drafts.get("uuuuuuuuuuuuuuuu", id, editorId));
  const first = editor.save();
  const other = api.add("other\n");
  api.gate = null;
  await editor.open(other);
  screen = editor.loadedText;
  release();
  await first;
  assert.equal(editor.id, other);
  assert.equal(editor.base, rev("other\n"), "nothing changed on screen");
  assert.equal(drafts.get("uuuuuuuuuuuuuuuu", id, editorId), null, "the draft whose text was saved is removed");
});

test("drafts across two editors: each stores under its own editor id; opening a note offers the others'", async () => {
  const id = await open("start\n");
  const firstEditor = editor.editorId;
  screen = "typed in tab one\n";
  editor.changed();
  await new Promise((r) => setTimeout(r, DRAFT_DELAY + 50));
  assert.equal(drafts.get("uuuuuuuuuuuuuuuu", id, firstEditor)?.text, "typed in tab one\n");
  // A second editor (another tab) opens the same note: the first's draft is offered.
  await editor.open(id);
  screen = editor.loadedText;
  editor.register(view);
  assert.notEqual(editor.editorId, firstEditor);
  assert.equal(editor.offered.length, 1);
  const d = editor.offered[0];
  // Opening it stores it under the current editor id before the old entry goes, and takes its base.
  editor.openDraft(d);
  assert.equal(screen, "typed in tab one\n");
  assert.equal(drafts.get("uuuuuuuuuuuuuuuu", id, firstEditor), null);
  assert.equal(drafts.get("uuuuuuuuuuuuuuuu", id, editor.editorId)?.text, "typed in tab one\n");
  assert.equal(editor.base, d.base);
  // After a save the draft is removed only if the editor's text is what was saved.
  await editor.save();
  assert.equal(drafts.get("uuuuuuuuuuuuuuuu", id, editor.editorId), null);
});

test("storage full: a warning stays until a write succeeds", async () => {
  const id = await open("a\n");
  storage.full = true;
  screen = "a b\n";
  editor.changed();
  editor.flushDraft();
  assert.equal(drafts.full, true);
  storage.full = false;
  screen = "a b c\n";
  editor.changed();
  editor.flushDraft();
  assert.equal(drafts.full, false);
  assert.equal(drafts.get("uuuuuuuuuuuuuuuu", id, editor.editorId)?.text, "a b c\n");
});

test("logout removes the user's drafts", async () => {
  await open("a\n");
  screen = "a b\n";
  editor.changed();
  editor.flushDraft();
  assert.equal(drafts.list("uuuuuuuuuuuuuuuu").length, 1);
  await session.logout();
  assert.equal(drafts.list("uuuuuuuuuuuuuuuu").length, 0);
  assert.equal(session.user, null);
});
