// SPEC2 12, server: two users cannot reach each other's notes, history, trash, photos, fonts or
// styles; path attacks on every id, version, file and slug.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { twoUsers, userDir } from "./http.ts";

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

test("two users cannot reach each other's notes, history, trash, photos, fonts or styles", async () => {
  const { s, alice, bob } = await twoUsers();
  const n = await alice.create("Alice's");
  const r = await alice.save(n.id, "secret\n", n.revision);
  const assets = path.join(userDir(s, "alice"), "notes", n.id, "note.assets");
  await fs.mkdir(assets);
  await fs.writeFile(path.join(assets, "p.png"), PNG);
  await alice.req("PUT", "/api/styles/Mine", { style: { name: "Mine", bold: true, italic: false, underline: false, strike: false, size: null, font: null, color: null, bg: null } });
  const v = (await alice.get(`/api/notes/${n.id}/history`)).json().versions[0].version;
  assert.equal((await alice.get(`/api/notes/${n.id}/assets/p.png`)).statusCode, 200);
  for (const url of [`/api/notes/${n.id}`, `/api/notes/${n.id}/history`, `/api/notes/${n.id}/history/${v}`, `/api/notes/${n.id}/assets/p.png`]) {
    assert.equal((await bob.get(url)).statusCode, 404, url);
  }
  assert.equal((await bob.save(n.id, "bob's\n", r.json().revision)).statusCode, 404);
  assert.equal((await bob.del(`/api/notes/${n.id}`)).statusCode, 404);
  assert.equal((await bob.get("/api/notes")).json().entries.length, 0);
  assert.equal((await bob.get("/api/notes?q=secret")).json().entries.length, 0);
  assert.equal((await bob.get("/api/styles")).json().styles.length, 0);
  assert.equal((await bob.del("/api/styles/Mine")).statusCode, 404);
  await alice.del(`/api/notes/${n.id}`);
  assert.equal((await bob.get("/api/trash")).json().entries.length, 0);
  assert.equal((await bob.get(`/api/trash/${n.id}`)).statusCode, 404);
  assert.equal((await bob.get(`/api/trash/${n.id}/assets/p.png`)).statusCode, 404);
  assert.equal((await bob.post(`/api/trash/${n.id}/restore`)).statusCode, 404);
  assert.deepEqual((await bob.post("/api/trash/empty", { ids: [n.id] })).json().removed, []);
  assert.equal((await alice.get(`/api/trash/${n.id}/assets/p.png`)).statusCode, 200, "a trashed note can be read with its photos");
  assert.equal((await alice.get("/api/trash")).json().entries.length, 1);
});

test("path attacks on every id, version, file and slug", async () => {
  const { s, alice } = await twoUsers();
  const n = await alice.create("x");
  const bobId = s.ctx.accounts.byName("bob")!.id;
  const attacks = ["..", "%2e%2e", "..%2F..%2Fconfig%2Fusers.json", "%2Fetc%2Fpasswd", `..%2F..%2F${bobId}`, "a%00b", "note.md", ".", "CON", "x".repeat(300)];
  for (const a of attacks) {
    for (const url of [`/api/notes/${a}`, `/api/notes/${a}/history`, `/api/notes/${n.id}/history/${a}`, `/api/notes/${n.id}/assets/${a}`, `/api/trash/${a}`, `/api/trash/${n.id}/assets/${a}`, `/api/fonts/preview/${a}`, `/api/fonts/${a}/1.woff2`, `/api/fonts/caveat/${a}`]) {
      const r = await alice.get(url);
      assert.ok([400, 404, 414].includes(r.statusCode), `${url}: ${r.statusCode}`);
      assert.ok(!r.body.includes("argon2") && !r.body.includes("root:"), url);
    }
    const d = await alice.del(`/api/styles/${a}`);
    assert.ok([400, 404, 414].includes(d.statusCode), `style ${a}: ${d.statusCode}`);
  }
  assert.ok(!(await fs.readdir(path.join(s.root, "config"))).includes("x"));
});

test("symbolic links are refused: a photo, an assets folder, a note file", async () => {
  // Each link points at something that would be served if it were not a link (review, 39): a
  // real image, a folder of real images, a real note of another user.
  const { s, alice, bob } = await twoUsers();
  const img = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#00ff00" } }).png().toBuffer();
  const b = await bob.create("Bob's");
  await bob.save(b.id, "bob's secret\n", b.revision);
  const bobAssets = path.join(userDir(s, "bob"), "notes", b.id, "note.assets");
  await fs.mkdir(bobAssets);
  await fs.writeFile(path.join(bobAssets, "p.png"), img);
  assert.equal((await bob.get(`/api/notes/${b.id}/assets/p.png`)).statusCode, 200, "the target itself is served");

  const n = await alice.create("x");
  const dir = path.join(userDir(s, "alice"), "notes", n.id);
  await fs.mkdir(path.join(dir, "note.assets"));
  await fs.writeFile(path.join(dir, "note.assets", "own.png"), img);
  assert.equal((await alice.get(`/api/notes/${n.id}/assets/own.png`)).statusCode, 200, "the same bytes as a plain file are served");
  // A photo that is a link to another user's photo.
  await fs.symlink(path.join(bobAssets, "p.png"), path.join(dir, "note.assets", "leak.png"));
  assert.equal((await alice.get(`/api/notes/${n.id}/assets/leak.png`)).statusCode, 404);
  // An assets folder that is a link to another user's.
  const m = await alice.create("y");
  const mdir = path.join(userDir(s, "alice"), "notes", m.id);
  await fs.symlink(bobAssets, path.join(mdir, "note.assets"));
  assert.equal((await alice.get(`/api/notes/${m.id}/assets/p.png`)).statusCode, 404);
  // A note.md that is a link to another user's note is not a note.
  await fs.rm(path.join(mdir, "note.md"));
  await fs.symlink(path.join(userDir(s, "bob"), "notes", b.id, "note.md"), path.join(mdir, "note.md"));
  assert.equal((await alice.get(`/api/notes/${m.id}`)).statusCode, 404);
  const list = await alice.get("/api/notes?q=secret");
  assert.equal(list.json().entries.length, 0);
  assert.ok(!list.body.includes("bob's secret"));
  // A photo whose bytes are not an image is not served.
  await fs.writeFile(path.join(dir, "note.assets", "fake.png"), "<svg onload=alert(1)>");
  assert.equal((await alice.get(`/api/notes/${n.id}/assets/fake.png`)).statusCode, 404);
});
