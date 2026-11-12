// SPEC2 12, server: each operation of 4.3 (and a save, 4.4) stopped after each step and
// restarted; the folder check of 4.5 (files edited by hand); the backup pause (13).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client, ls, PASSWORD, startServer, type TestServer } from "./http.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

type Req = { method: string; url: string; body?: unknown; text?: string; headers?: Record<string, string> };

/**
 * Runs one request with a crash at `stepName`: in a child process that kills itself with
 * SIGKILL there, so nothing of the server's clean-up runs (review, 42: a thrown error let it
 * run). Then a fresh server on the same folder.
 */
async function crashAt(s: TestServer, stepName: string, req: Req, cookie: string): Promise<{ s2: TestServer; c: Client }> {
  await s.app.close();
  const child = spawnSync(process.execPath, [fileURLToPath(new URL("./crash-child.ts", import.meta.url)), JSON.stringify({ root: s.root, step: stepName, cookie, ...req })], { encoding: "utf8" });
  assert.equal(child.signal, "SIGKILL", `the request did not reach ${stepName}: ${child.status} ${child.stderr}`);
  const s2 = await startServer({}, s.root);
  const c = new Client(s2.app);
  await c.login("alice");
  return { s2, c };
}

async function setup(): Promise<{ s: TestServer; c: Client; dir: string }> {
  const s = await startServer();
  await s.ctx.addUser("alice", PASSWORD);
  const c = new Client(s.app);
  await c.login("alice");
  return { s, c, dir: path.join(s.root, "users", s.ctx.accounts.byName("alice")!.id) };
}

test("create, stopped after each step: nothing, or the note; tmp/ is emptied at startup", async () => {
  for (const [stepName, live] of [["create:built", 0], ["create:renamed", 1]] as const) {
    const { s, c, dir } = await setup();
    const { c: c2 } = await crashAt(s, stepName, { method: "POST", url: "/api/notes", body: { title: "T" } }, c.cookie);
    assert.equal((await c2.get("/api/notes")).json().entries.length, live, stepName);
    assert.deepEqual(await ls(path.join(dir, "tmp")), [], stepName);
  }
});

test("trash, stopped after each step: a live note with a stray trashed.json, or the trashed note", async () => {
  for (const stepName of ["trash:marked", "trash:moved"]) {
    const { s, c, dir } = await setup();
    const n = await c.create("T");
    const { c: c2 } = await crashAt(s, stepName, { method: "DELETE", url: `/api/notes/${n.id}` }, c.cookie);
    const live = (await c2.get("/api/notes")).json().entries.length;
    const trashed = (await c2.get("/api/trash")).json().entries.length;
    assert.equal(live + trashed, 1, stepName);
    if (stepName === "trash:marked") {
      assert.equal(live, 1);
      assert.ok((await ls(path.join(dir, "notes", n.id))).includes("trashed.json"), "the stray file is there");
      // It is ignored, and replaced next time.
      assert.equal((await c2.get(`/api/notes/${n.id}`)).statusCode, 200);
      assert.equal((await c2.del(`/api/notes/${n.id}`)).statusCode, 200);
      assert.equal((await c2.get("/api/trash")).json().entries.length, 1);
    } else assert.equal(trashed, 1);
  }
});

test("restore, stopped after each step", async () => {
  for (const stepName of ["restore:moved", "restore:unmarked"]) {
    const { s, c } = await setup();
    const n = await c.create("T");
    await c.del(`/api/notes/${n.id}`);
    const { c: c2 } = await crashAt(s, stepName, { method: "POST", url: `/api/trash/${n.id}/restore` }, c.cookie);
    assert.equal((await c2.get(`/api/notes/${n.id}`)).statusCode, 200, stepName);
    assert.equal((await c2.get("/api/trash")).json().entries.length, 0);
  }
});

test("empty, stopped after the rename: a folder in tmp/, removed at startup", async () => {
  const { s, c, dir } = await setup();
  const n = await c.create("T");
  await c.del(`/api/notes/${n.id}`);
  const { c: c2 } = await crashAt(s, "empty:moved", { method: "POST", url: "/api/trash/empty", body: { ids: [n.id] } }, c.cookie);
  assert.equal((await c2.get("/api/trash")).json().entries.length, 0);
  assert.deepEqual(await ls(path.join(dir, "tmp")), []);
  assert.deepEqual(await ls(path.join(dir, "trash")), []);
});

test("save, stopped after each step: the old note or the new one, at worst one extra history file", async () => {
  for (const [stepName, want] of [["save:history", "old\n"], ["save:replaced", "new\n"]] as const) {
    const { s, c } = await setup();
    const n = await c.create("T");
    const r = await c.save(n.id, "old\n", n.revision);
    const { c: c2 } = await crashAt(s, stepName, { method: "PUT", url: `/api/notes/${n.id}`, text: "new\n", headers: { "content-type": "text/markdown", "if-match": r.json().revision } }, c.cookie);
    const got = (await c2.get(`/api/notes/${n.id}`)).json();
    assert.equal(got.text, want, stepName);
    const versions = (await c2.get(`/api/notes/${n.id}/history`)).json().versions;
    assert.equal(versions.length, 2, "the first save's history, and one from the stopped save");
    // A save from the text on disk still works.
    assert.equal((await c2.save(n.id, "again\n", sha(want))).statusCode, 200);
  }
});

test("the folder check: files edited, added, removed and broken by hand", async () => {
  const { c, dir } = await setup();
  const n = await c.create("Before");
  const file = path.join(dir, "notes", n.id, "note.md");
  // An edit by hand: the list sees it; a browser holding the old text gets 409.
  await fs.writeFile(file, "# Edited by hand\n\nMore text.\n");
  const t = Date.now() / 1000 + 5;
  await fs.utimes(file, t, t);
  assert.equal((await c.get("/api/notes")).json().entries[0].title, "Edited by hand");
  assert.equal((await c.save(n.id, "mine\n", n.revision)).statusCode, 409);
  // A note added by hand: a folder under a new id, moved in.
  const id = "abcdefghijklmnopqrstuvwx";
  await fs.mkdir(path.join(dir, "elsewhere", id), { recursive: true });
  await fs.writeFile(path.join(dir, "elsewhere", id, "note.md"), "---\ntitle: By hand\ntags: [x]\n---\n");
  await fs.rename(path.join(dir, "elsewhere", id), path.join(dir, "notes", id));
  let list = (await c.get("/api/notes")).json();
  assert.ok(list.entries.some((e: { id: string; title: string }) => e.id === id && e.title === "By hand"));
  // Ignored: a folder with a name that is not an id, one without note.md, a symbolic link.
  await fs.mkdir(path.join(dir, "notes", "not-an-id"));
  await fs.writeFile(path.join(dir, "notes", "not-an-id", "note.md"), "x");
  await fs.mkdir(path.join(dir, "notes", "bbbbbbbbbbbbbbbbbbbbbbbb"));
  await fs.symlink(path.join(dir, "notes", id), path.join(dir, "notes", "cccccccccccccccccccccccc"));
  list = (await c.get("/api/notes")).json();
  assert.equal(list.entries.length, 2);
  // Not UTF-8: listed as "cannot be opened", never written.
  await fs.writeFile(path.join(dir, "notes", id, "note.md"), Buffer.from([0xc3, 0x28, 0x0a]));
  list = (await c.get("/api/notes")).json();
  const bad = list.entries.find((e: { id: string }) => e.id === id);
  assert.equal(bad.problem, "unreadable");
  assert.equal((await c.get(`/api/notes/${id}`)).statusCode, 422);
  // Broken front matter on disk: listed with a warning, opens.
  await fs.writeFile(path.join(dir, "notes", id, "note.md"), "---\n: [\n---\n\ntext\n");
  list = (await c.get("/api/notes")).json();
  assert.equal(list.entries.find((e: { id: string }) => e.id === id).problem, "broken");
  assert.equal((await c.get(`/api/notes/${id}`)).statusCode, 200);
  // Removed by hand.
  await fs.rm(path.join(dir, "notes", id), { recursive: true });
  assert.equal((await c.get("/api/notes")).json().entries.length, 1);
  assert.equal((await c.get(`/api/notes/${id}`)).statusCode, 404);
});

test("the backup pause: requests that need a lock wait for it; none is refused", async () => {
  const { s, c } = await setup();
  const n = await c.create("T");
  await s.ctx.pauseWrites();
  let done = false;
  const pending = c.save(n.id, "during the pause\n", n.revision).then((r) => {
    done = true;
    return r;
  });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(done, false, "the save waits");
  assert.equal(s.ctx.resumeWrites(), true);
  assert.equal((await pending).statusCode, 200);
  assert.equal(s.ctx.resumeWrites(), false, "no pause in force any more");
  await s.ctx.backupDone();
  assert.match((await c.get("/api/me")).json().lastBackup, /^\d{4}-/);
});

test("remove-user moves the user's folder to removed/ and ends their sessions", async () => {
  const { s, c } = await setup();
  await c.create("T");
  const folder = await s.ctx.removeUser("alice");
  assert.ok((await ls(path.join(s.root, "removed"))).includes(folder));
  assert.equal((await c.get("/api/me")).statusCode, 401);
  assert.deepEqual(await ls(path.join(s.root, "users")), []);
});
