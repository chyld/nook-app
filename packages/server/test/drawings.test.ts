// SPEC-DRAWINGS 8, server: a drawing created, read, saved; 409, 410, 413 at each kind's limit,
// 415 for the wrong type, each 422 reason; history and its limit of 20, restore; trash and
// restore; save as new with images filled in and with photosMissing; search by drawing text;
// each row of the table of 4.6; each operation of SPEC2 4.3 stopped after each step for a
// drawing; two users kept apart; path attacks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DRAWING_TYPE, LIMITS, MB } from "../../contract/src/index.ts";
import { emptyDrawing, serializeDrawing } from "../../core/src/index.ts";
import sharp from "sharp";
import { Client, ls, multipart, PASSWORD, startServer, twoUsers, userDir, type TestServer } from "./http.ts";

const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const today = () => new Date().toISOString().slice(0, 10);

const rect = (id: string, version = 1) => ({ type: "rectangle", id, version, versionNonce: 1, x: 0, y: 0, width: 10, height: 10, isDeleted: false });
const textEl = (id: string, text: string, originalText = text) => ({ type: "text", id, version: 1, text, originalText, isDeleted: false });
const imageEl = (id: string, fileId: string) => ({ type: "image", id, version: 1, fileId, status: "saved", isDeleted: false });
const png = (id: string) => ({ id, mimeType: "image/png", dataURL: `data:image/png;base64,${id}AAAA`, created: 1 });
const scene = (elements: unknown[], files: Record<string, unknown> = {}, nook = { title: "Plan", tags: ["work"], created: "2026-11-12" }, bg = "#ffffff") =>
  serializeDrawing({ elements, appState: { viewBackgroundColor: bg }, files }, nook);

/** Requests of a drawing, beside the note requests of `Client`. */
function saveDrawing(c: Client, id: string, text: string | Buffer, revision: string) {
  return c.req("PUT", `/api/notes/${id}`, Buffer.isBuffer(text) ? text : Buffer.from(text, "utf8"), { "content-type": DRAWING_TYPE, "if-match": revision });
}
function drawingAsNew(c: Client, text: string, from?: string) {
  return c.req("POST", `/api/notes${from ? `?from=${from}` : ""}`, Buffer.from(text, "utf8"), { "content-type": DRAWING_TYPE });
}
async function newDrawing(c: Client, title?: string): Promise<{ id: string; revision: string; text: string; entry: Record<string, unknown> }> {
  const r = await c.post("/api/notes", title === undefined ? { kind: "drawing" } : { title, kind: "drawing" });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
}

async function setup(): Promise<{ s: TestServer; c: Client; dir: string }> {
  const s = await startServer();
  await s.ctx.addUser("alice", PASSWORD);
  const c = new Client(s.app);
  await c.login("alice");
  return { s, c, dir: path.join(s.root, "users", s.ctx.accounts.byName("alice")!.id) };
}

test("create: a drawing.excalidraw of the form of 4.2; Untitled N counts notes and drawings; kind in every entry", async () => {
  const { c, dir } = await setup();
  const d = await newDrawing(c);
  assert.equal(d.text, emptyDrawing("Untitled 1", today()));
  assert.deepEqual(d.entry, { id: d.id, kind: "drawing", title: "Untitled 1", tags: [], created: today(), modified: d.entry.modified, size: Buffer.byteLength(d.text), agent: null });
  assert.deepEqual(await ls(path.join(dir, "notes", d.id)), ["drawing.excalidraw"]);
  const n = await c.create();
  assert.equal((await c.get(`/api/notes/${n.id}`)).json().entry.title, "Untitled 2", "a note counts drawings");
  assert.equal((await newDrawing(c)).entry.title, "Untitled 3", "a drawing counts notes");
  assert.equal((await newDrawing(c, "  My   plan ")).entry.title, "My plan");
  assert.equal((await c.post("/api/notes", { kind: "picture" })).statusCode, 400, "an unknown kind");
  assert.equal((await c.post("/api/notes", {})).json().entry.kind, "note", "the kind defaults to note");
  const list = (await c.get("/api/notes")).json();
  assert.deepEqual(new Set(list.entries.map((e: { kind: string }) => e.kind)), new Set(["note", "drawing"]));
});

test("read and save: the bytes as sent, history of the old bytes, 409 with the current drawing", async () => {
  const { c, dir } = await setup();
  const d = await newDrawing(c);
  const r = (await c.get(`/api/notes/${d.id}`)).json();
  assert.equal(r.text, d.text);
  assert.equal(r.revision, sha(d.text));
  assert.equal(r.entry.kind, "drawing");
  const v1 = scene([rect("a")]);
  const s1 = await saveDrawing(c, d.id, v1, d.revision);
  assert.equal(s1.statusCode, 200, s1.body);
  assert.equal(s1.json().revision, sha(v1));
  assert.equal(s1.json().entry.title, "Plan", "the entry from the new file");
  assert.equal(await fs.readFile(path.join(dir, "notes", d.id, "drawing.excalidraw"), "utf8"), v1, "the server never changes the bytes of a save");
  const hist = await ls(path.join(dir, "notes", d.id, "history"));
  assert.equal(hist.length, 1);
  assert.match(hist[0], /\.excalidraw$/);
  assert.equal(await fs.readFile(path.join(dir, "notes", d.id, "history", hist[0]), "utf8"), d.text);
  // The same bytes again: nothing written.
  assert.equal((await saveDrawing(c, d.id, v1, sha(v1))).statusCode, 200);
  assert.equal((await ls(path.join(dir, "notes", d.id, "history"))).length, 1);
  // A stale revision.
  const stale = await saveDrawing(c, d.id, scene([rect("b")]), d.revision);
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error.code, "changed");
  assert.equal(stale.json().current.text, v1);
  assert.equal(stale.json().current.entry.kind, "drawing");
});

test("410 in the trash, 404 unknown; 413 at each kind's limit; 415 for the wrong type", async () => {
  const { c } = await setup();
  const d = await newDrawing(c);
  const n = await c.create("A note");
  // 413 at each kind's own limit.
  const padTo = (n: number) => {
    const base = scene([textEl("t", "x")]);
    return base.replace('"text": "x"', `"text": "${"x".repeat(n - Buffer.byteLength(base) + 1)}"`);
  };
  const atLimit = padTo(LIMITS.drawingBytes);
  assert.equal(Buffer.byteLength(atLimit), LIMITS.drawingBytes);
  assert.equal((await saveDrawing(c, d.id, atLimit, d.revision)).statusCode, 200, "a drawing of exactly 25 MB");
  const over = padTo(LIMITS.drawingBytes + 1);
  const big = await saveDrawing(c, d.id, over, sha(atLimit));
  assert.equal(big.statusCode, 413);
  assert.match(big.json().error.message, /25\.0 MB; a drawing may be at most 25 MB/);
  assert.equal(big.json().size, LIMITS.drawingBytes + 1);
  assert.equal((await c.save(n.id, "x".repeat(LIMITS.noteBytes), n.revision)).statusCode, 200, "a note of exactly 2 MB");
  const bigNote = await c.save(n.id, "y".repeat(LIMITS.noteBytes + 1), sha("x".repeat(LIMITS.noteBytes)));
  assert.equal(bigNote.statusCode, 413, "a note's limit is still 2 MB, though the route takes 25");
  assert.equal((await c.save(n.id, "z".repeat(26 * MB), n.revision)).statusCode, 413, "past the route's limit");
  // 415: a body type that is not the item's kind.
  const wrong1 = await c.save(d.id, "# text\n", sha(atLimit));
  assert.equal(wrong1.statusCode, 415, "Markdown to a drawing");
  const wrong2 = await saveDrawing(c, n.id, scene([]), sha("x".repeat(LIMITS.noteBytes)));
  assert.equal(wrong2.statusCode, 415, "a drawing to a note");
  assert.equal((await c.req("PUT", `/api/notes/${d.id}`, { a: 1 }, { "if-match": sha(atLimit) })).statusCode, 415, "JSON to a save");
  assert.equal((await c.req("PUT", `/api/notes/${d.id}`, Buffer.from("{}"), { "content-type": "application/vnd.other+json", "if-match": sha(atLimit) })).statusCode, 415);
  // 410 and 404.
  assert.equal((await c.del(`/api/notes/${d.id}`)).statusCode, 200);
  assert.equal((await saveDrawing(c, d.id, scene([]), sha(atLimit))).statusCode, 410);
  assert.equal((await c.get(`/api/notes/${d.id}`)).statusCode, 410);
  assert.equal((await saveDrawing(c, "abcdefghijklmnopqrstuvwx", scene([]), sha("x"))).statusCode, 404);
  // A JSON body is still at most 64 KB, on the create route that takes 25 MB.
  assert.equal((await c.post("/api/notes", { title: "x".repeat(70 * 1024), kind: "drawing" })).statusCode, 413);
});

test("each 422 reason; a save of a file from elsewhere is accepted as it is", async () => {
  const { c } = await setup();
  const d = await newDrawing(c);
  const cases: [Buffer, string][] = [
    [Buffer.from([0x7b, 0xc3, 0x28, 0x7d]), "not-utf8"],
    [Buffer.from("not json"), "not-json"],
    [Buffer.from("[1, 2]"), "not-json"],
    [Buffer.from('{"type":"excalidraw","elements":{}}'), "not-excalidraw"],
    [Buffer.from('{"type":"other","elements":[]}'), "not-excalidraw"],
    [Buffer.from('{"elements":[]}'), "not-excalidraw"],
  ];
  for (const [bytes, code] of cases) {
    const r = await saveDrawing(c, d.id, bytes, d.revision);
    assert.equal(r.statusCode, 422, code);
    assert.equal(r.json().error.code, code);
    const n = await drawingAsNew(c, bytes.toString("latin1"));
    if (code !== "not-utf8") assert.equal(n.statusCode, 422, `save as new: ${code}`);
  }
  const foreign = JSON.stringify({ type: "excalidraw", elements: [] });
  assert.equal((await saveDrawing(c, d.id, foreign, d.revision)).statusCode, 200);
});

test("history keeps a drawing's newest 20 versions; a version is read and restored by a save", async () => {
  const { c, dir } = await setup();
  const d = await newDrawing(c);
  let rev = d.revision;
  const texts: string[] = [d.text];
  for (let i = 1; i <= 23; i++) {
    const t = scene([rect("a", i)]);
    const r = await saveDrawing(c, d.id, t, rev);
    assert.equal(r.statusCode, 200);
    rev = r.json().revision;
    texts.push(t);
  }
  const versions = (await c.get(`/api/notes/${d.id}/history`)).json().versions;
  assert.equal(versions.length, LIMITS.drawingHistory);
  assert.equal((await ls(path.join(dir, "notes", d.id, "history"))).length, 20);
  // Newest first: the newest version holds the text before the last save.
  const newest = (await c.get(`/api/notes/${d.id}/history/${versions[0].version}`)).json().text;
  assert.equal(newest, texts[22]);
  const oldest = (await c.get(`/api/notes/${d.id}/history/${versions[19].version}`)).json().text;
  assert.equal(oldest, texts[3], "the oldest kept");
  // Restore: an ordinary save of that version's text against the current revision.
  const back = await saveDrawing(c, d.id, oldest, rev);
  assert.equal(back.statusCode, 200);
  assert.equal((await c.get(`/api/notes/${d.id}`)).json().text, oldest);
  // A note still keeps 50, as Markdown.
  const n = await c.create("N");
  let nrev = n.revision;
  for (let i = 0; i < 52; i++) nrev = (await c.save(n.id, `v${i}\n`, nrev)).json().revision;
  assert.equal((await c.get(`/api/notes/${n.id}/history`)).json().versions.length, LIMITS.history);
  assert.ok((await ls(path.join(dir, "notes", n.id, "history"))).every((f) => f.endsWith(".md")));
});

test("trash and restore a drawing; the trash list says it is a drawing; empty", async () => {
  const { c, dir } = await setup();
  const d = await newDrawing(c, "Sketch");
  const v = scene([rect("a")], {}, { title: "Sketch", tags: ["art"], created: "2026-11-12" });
  await saveDrawing(c, d.id, v, d.revision);
  assert.equal((await c.del(`/api/notes/${d.id}`)).statusCode, 200);
  const t = (await c.get("/api/trash")).json().entries;
  assert.deepEqual(t.map((e: { id: string; kind: string; title: string; tags: string[] }) => [e.id, e.kind, e.title, e.tags]), [[d.id, "drawing", "Sketch", ["art"]]]);
  assert.equal((await c.get(`/api/trash/${d.id}`)).json().entry.kind, "drawing");
  assert.ok((await ls(path.join(dir, "trash", d.id))).includes("history"), "the folder moved whole");
  const r = await c.post(`/api/trash/${d.id}/restore`);
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().entry.kind, "drawing");
  assert.equal((await c.get(`/api/notes/${d.id}`)).json().text, v);
  assert.equal((await c.get(`/api/notes/${d.id}/history`)).json().versions.length, 1);
  await c.del(`/api/notes/${d.id}`);
  assert.deepEqual((await c.post("/api/trash/empty", { ids: [d.id] })).json().removed, [d.id]);
  assert.deepEqual(await ls(path.join(dir, "trash")), []);
});

test("save as new: the images the draft's elements use come from the source; photosMissing otherwise", async () => {
  const { c } = await setup();
  const d = await newDrawing(c, "Pictures");
  const full = scene([imageEl("i1", "fa"), imageEl("i2", "fb"), rect("r")], { fa: png("fa"), fb: png("fb"), unused: png("unused") });
  await saveDrawing(c, d.id, full, d.revision);
  // A draft has no image data; one image was added after the last save (fc).
  const draft = scene([imageEl("i1", "fa"), imageEl("i2", "fb"), imageEl("i3", "fc"), rect("r", 2)], {});
  // The source is in the trash.
  await c.del(`/api/notes/${d.id}`);
  const r = await drawingAsNew(c, draft, d.id);
  assert.equal(r.statusCode, 201, r.body);
  assert.equal(r.json().entry.kind, "drawing");
  assert.equal(r.json().photosMissing, true, "fc is in neither");
  const doc = JSON.parse(r.json().text);
  assert.deepEqual(Object.keys(doc.files), ["fa", "fb"]);
  assert.deepEqual(doc.files.fa, png("fa"));
  assert.equal(doc.elements.length, 4);
  // With every image found: photosMissing false. The source live.
  await c.post(`/api/trash/${d.id}/restore`);
  const r2 = await drawingAsNew(c, scene([imageEl("i1", "fb")], {}), d.id);
  assert.equal(r2.json().photosMissing, false);
  assert.deepEqual(Object.keys(JSON.parse(r2.json().text).files), ["fb"]);
  // No source, no images used: the bytes as sent.
  const plain = scene([rect("x")]);
  const r3 = await drawingAsNew(c, plain);
  assert.equal(r3.json().text, plain);
  assert.equal(r3.json().photosMissing, false);
  // No source, an image used: missing.
  assert.equal((await drawingAsNew(c, scene([imageEl("i", "fz")]))).json().photosMissing, true);
  // A source that is a note gives nothing.
  const n = await c.create("note");
  assert.equal((await drawingAsNew(c, scene([imageEl("i", "fa")]), n.id)).json().photosMissing, true);
  // A note saved as new is still Markdown, of the kind its type names.
  const nn = await c.saveAsNew("# New\n");
  assert.equal(nn.json().entry.kind, "note");
});

test("search by the text of a drawing, its title and tags; never the JSON", async () => {
  const { c } = await setup();
  const d = await newDrawing(c);
  await saveDrawing(c, d.id, scene([textEl("t1", "the quick\nbrown", "the quick brown"), textEl("t2", "fox jumps")], {}, { title: "Animals", tags: ["zoo"], created: "2026-11-12" }), d.revision);
  await c.create("Other note");
  const q = async (s: string) => (await c.get(`/api/notes?q=${encodeURIComponent(s)}`)).json().entries;
  const found = await q("quick brown");
  assert.deepEqual(found.map((e: { id: string }) => e.id), [d.id], "originalText");
  assert.match(found[0].excerpt, /quick brown/);
  assert.equal((await q("fox")).length, 1);
  assert.equal((await q("animals")).length, 1, "the title");
  assert.equal((await q("zoo")).length, 1, "a tag");
  assert.equal((await q("rectangle")).length, 0);
  assert.equal((await q("excalidraw")).length, 0, "never the JSON");
  assert.equal((await q("versionNonce")).length, 0);
  const tagged = (await c.get("/api/notes?tag=zoo")).json();
  assert.deepEqual(tagged.entries.map((e: { id: string }) => e.id), [d.id]);
  assert.deepEqual(tagged.tags, [{ tag: "zoo", count: 1 }]);
});

test("the table of 4.6: not UTF-8, broken, and a file Nook did not write", async () => {
  const { c, dir } = await setup();
  const put = async (id: string, bytes: Buffer | string) => {
    await fs.mkdir(path.join(dir, "elsewhere", id), { recursive: true });
    await fs.writeFile(path.join(dir, "elsewhere", id, "drawing.excalidraw"), bytes);
    await fs.rename(path.join(dir, "elsewhere", id), path.join(dir, "notes", id));
  };
  const entry = async (id: string) => (await c.get("/api/notes")).json().entries.find((e: { id: string }) => e.id === id);
  // Not valid UTF-8: listed as unreadable, refused, never written.
  const u = "aaaaaaaaaaaaaaaaaaaaaaaa";
  await put(u, Buffer.from([0x7b, 0xc3, 0x28, 0x7d]));
  assert.equal((await entry(u)).problem, "unreadable");
  assert.equal((await entry(u)).kind, "drawing");
  assert.equal((await c.get(`/api/notes/${u}`)).statusCode, 422);
  // Not JSON, or not a scene: broken, titled Untitled; it reads (the screen says it cannot be
  // read), and a save to it is refused by its check of the new bytes only when they are wrong.
  for (const [id, bytes] of [["bbbbbbbbbbbbbbbbbbbbbbbb", "not json"], ["cccccccccccccccccccccccc", '{"type":"excalidraw","elements":"x","nook":{"title":"T"}}']] as const) {
    await put(id, bytes);
    const e = await entry(id);
    assert.equal(e.problem, "broken", bytes);
    assert.equal(e.title, "Untitled");
    assert.equal((await c.get(`/api/notes/${id}`)).json().entry.problem, "broken");
  }
  // From excalidraw.com, with an image: opens; a save writes Nook's form, keeping its image; the
  // old bytes are in history.
  const x = "dddddddddddddddddddddddd";
  const theirs = JSON.stringify({ type: "excalidraw", version: 2, source: "https://excalidraw.com", elements: [{ ...imageEl("i", "f1"), angle: 0 }, textEl("t", "hello")], appState: { gridSize: 20, viewBackgroundColor: "#fff", zoom: { value: 1 } }, files: { f1: png("f1") } });
  await put(x, theirs);
  const e = await entry(x);
  assert.equal(e.problem, undefined);
  assert.equal(e.title, "Untitled");
  assert.deepEqual(e.tags, []);
  assert.equal(e.created, null);
  const r = (await c.get(`/api/notes/${x}`)).json();
  assert.equal(r.text, theirs);
  const mine = serializeDrawing(JSON.parse(theirs), { title: "Untitled", tags: [], created: null });
  assert.equal((await saveDrawing(c, x, mine, r.revision)).statusCode, 200);
  assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(path.join(dir, "notes", x, "drawing.excalidraw"), "utf8")).files), ["f1"]);
  const v = (await c.get(`/api/notes/${x}/history`)).json().versions;
  assert.equal((await c.get(`/api/notes/${x}/history/${v[0].version}`)).json().text, theirs);
  // A folder with both files is a note; with neither, or a drawing.excalidraw that is a folder,
  // it is ignored.
  const both = "eeeeeeeeeeeeeeeeeeeeeeee";
  await fs.mkdir(path.join(dir, "notes", both));
  await fs.writeFile(path.join(dir, "notes", both, "note.md"), "# A note\n");
  await fs.writeFile(path.join(dir, "notes", both, "drawing.excalidraw"), emptyDrawing("D", "2026-11-12"));
  assert.equal((await entry(both)).kind, "note");
  const odd = "ffffffffffffffffffffffff";
  await fs.mkdir(path.join(dir, "notes", odd, "drawing.excalidraw"), { recursive: true });
  assert.equal(await entry(odd), undefined);
  // An edit by hand is seen, and a browser holding the old bytes gets 409.
  const d = await newDrawing(c);
  const file = path.join(dir, "notes", d.id, "drawing.excalidraw");
  await fs.writeFile(file, scene([textEl("t", "by hand")], {}, { title: "Hand", tags: [], created: "2026-11-12" }));
  const t = Date.now() / 1000 + 5;
  await fs.utimes(file, t, t);
  assert.equal((await entry(d.id)).title, "Hand");
  assert.equal((await saveDrawing(c, d.id, scene([]), d.revision)).statusCode, 409);
});

test("photos and assets answer 404 for a drawing", async () => {
  const { c, dir } = await setup();
  const d = await newDrawing(c);
  const photo = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
  const up = multipart("p.png", photo, "image/png");
  const r = await c.req("POST", `/api/notes/${d.id}/photos`, up.body, up.headers);
  assert.equal(r.statusCode, 404, r.body);
  assert.deepEqual(await ls(path.join(dir, "notes", d.id)), ["drawing.excalidraw"], "nothing stored");
  await fs.mkdir(path.join(dir, "notes", d.id, "note.assets"));
  await fs.writeFile(path.join(dir, "notes", d.id, "note.assets", "p.png"), Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"));
  assert.equal((await c.get(`/api/notes/${d.id}/assets/p.png`)).statusCode, 404);
  await c.del(`/api/notes/${d.id}`);
  assert.equal((await c.get(`/api/trash/${d.id}/assets/p.png`)).statusCode, 404);
});

test("the drawing pages are answered with the app's page", async () => {
  const { c } = await setup();
  for (const p of ["/d/aaaaaaaaaaaaaaaaaaaaaaaa", "/d/aaaaaaaaaaaaaaaaaaaaaaaa/history"]) {
    const r = await c.get(p);
    assert.equal(r.statusCode, 200, p);
    assert.match(r.headers["content-type"] as string, /text\/html/);
    assert.match(r.headers["content-security-policy"] as string, /frame-src https:/);
  }
});

test("two users cannot reach each other's drawings", async () => {
  const { s, alice, bob } = await twoUsers();
  const d = await newDrawing(alice, "Secret sketch");
  await saveDrawing(alice, d.id, scene([textEl("t", "secretword")], {}, { title: "Secret sketch", tags: [], created: "2026-11-12" }), d.revision);
  assert.equal((await bob.get(`/api/notes/${d.id}`)).statusCode, 404);
  assert.equal((await saveDrawing(bob, d.id, scene([]), sha(""))).statusCode, 404);
  assert.equal((await bob.get(`/api/notes/${d.id}/history`)).statusCode, 404);
  assert.equal((await bob.get("/api/notes?q=secretword")).json().entries.length, 0);
  assert.equal((await bob.del(`/api/notes/${d.id}`)).statusCode, 404);
  assert.equal((await drawingAsNew(bob, scene([imageEl("i", "fa")]), d.id)).json().photosMissing, true);
  await alice.del(`/api/notes/${d.id}`);
  assert.equal((await bob.post(`/api/trash/${d.id}/restore`)).statusCode, 404);
  assert.equal((await bob.get("/api/trash")).json().entries.length, 0);
  assert.equal((await alice.get("/api/trash")).json().entries.length, 1);
  void s;
});

test("path attacks on a drawing's id and versions; links are refused", async () => {
  const { s, alice, bob } = await twoUsers();
  const d = await newDrawing(alice);
  const b = await newDrawing(bob, "Bob's");
  for (const a of ["..", "%2e%2e", "..%2F..%2Fconfig%2Fusers.json", "drawing.excalidraw", "a%00b"]) {
    assert.ok([400, 404].includes((await alice.get(`/api/notes/${a}`)).statusCode), a);
    assert.ok([400, 404].includes((await alice.get(`/api/notes/${d.id}/history/${a}`)).statusCode), a);
    assert.ok([400, 404, 415].includes((await saveDrawing(alice, a, scene([]), sha(""))).statusCode), a);
  }
  // A drawing.excalidraw that is a link to bob's file is not a drawing.
  const mine = path.join(userDir(s, "alice"), "notes", d.id, "drawing.excalidraw");
  await fs.rm(mine);
  await fs.symlink(path.join(userDir(s, "bob"), "notes", b.id, "drawing.excalidraw"), mine);
  assert.equal((await alice.get(`/api/notes/${d.id}`)).statusCode, 404);
  assert.ok(!(await alice.get("/api/notes")).body.includes("Bob's"));
  // A history file that is a link is not served.
  const d2 = await newDrawing(alice);
  const r = await saveDrawing(alice, d2.id, scene([rect("a")]), d2.revision);
  assert.equal(r.statusCode, 200);
  const hdir = path.join(userDir(s, "alice"), "notes", d2.id, "history");
  const [v] = await ls(hdir);
  await fs.rm(path.join(hdir, v));
  await fs.symlink(path.join(userDir(s, "bob"), "notes", b.id, "drawing.excalidraw"), path.join(hdir, v));
  const got = await alice.get(`/api/notes/${d2.id}/history/${v.replace(/\.excalidraw$/, "")}`);
  assert.equal(got.statusCode, 404);
});

// --- each operation of SPEC2 4.3 stopped after each step, for a drawing --------------------------

type Req = { method: string; url: string; body?: unknown; text?: string; headers?: Record<string, string> };

/** As storage.test.ts's: one request in a child that kills itself at `stepName`, then a fresh
 *  server on the same folder. */
async function crashAt(s: TestServer, stepName: string, req: Req, cookie: string): Promise<{ c: Client }> {
  await s.app.close();
  const child = spawnSync(process.execPath, [fileURLToPath(new URL("./crash-child.ts", import.meta.url)), JSON.stringify({ root: s.root, step: stepName, cookie, ...req })], { encoding: "utf8" });
  assert.equal(child.signal, "SIGKILL", `the request did not reach ${stepName}: ${child.status} ${child.stderr}`);
  const s2 = await startServer({}, s.root);
  const c = new Client(s2.app);
  await c.login("alice");
  return { c };
}

test("a drawing's create, stopped after each step: nothing, or the drawing; tmp/ emptied", async () => {
  for (const [stepName, live] of [["create:built", 0], ["create:renamed", 1]] as const) {
    const { s, c, dir } = await setup();
    const { c: c2 } = await crashAt(s, stepName, { method: "POST", url: "/api/notes", body: { title: "T", kind: "drawing" } }, c.cookie);
    const entries = (await c2.get("/api/notes")).json().entries;
    assert.equal(entries.length, live, stepName);
    if (live) assert.equal(entries[0].kind, "drawing");
    assert.deepEqual(await ls(path.join(dir, "tmp")), [], stepName);
  }
});

test("a drawing's save as new, stopped after each step", async () => {
  for (const [stepName, live] of [["create:built", 0], ["create:renamed", 1]] as const) {
    const { s, c, dir } = await setup();
    const { c: c2 } = await crashAt(s, stepName, { method: "POST", url: "/api/notes", text: scene([rect("a")]), headers: { "content-type": DRAWING_TYPE } }, c.cookie);
    assert.equal((await c2.get("/api/notes")).json().entries.length, live, stepName);
    assert.deepEqual(await ls(path.join(dir, "tmp")), [], stepName);
  }
});

test("a drawing's trash, restore and empty, stopped after each step", async () => {
  for (const stepName of ["trash:marked", "trash:moved"]) {
    const { s, c } = await setup();
    const d = await newDrawing(c);
    const { c: c2 } = await crashAt(s, stepName, { method: "DELETE", url: `/api/notes/${d.id}` }, c.cookie);
    const live = (await c2.get("/api/notes")).json().entries;
    const trashed = (await c2.get("/api/trash")).json().entries;
    assert.equal(live.length + trashed.length, 1, stepName);
    assert.equal([...live, ...trashed][0].kind, "drawing");
    if (stepName === "trash:marked") assert.equal((await c2.del(`/api/notes/${d.id}`)).statusCode, 200, "trashed again");
  }
  for (const stepName of ["restore:moved", "restore:unmarked"]) {
    const { s, c } = await setup();
    const d = await newDrawing(c);
    await c.del(`/api/notes/${d.id}`);
    const { c: c2 } = await crashAt(s, stepName, { method: "POST", url: `/api/trash/${d.id}/restore` }, c.cookie);
    const r = await c2.get(`/api/notes/${d.id}`);
    assert.equal(r.statusCode, 200, stepName);
    assert.equal(r.json().entry.kind, "drawing");
    assert.equal((await c2.get("/api/trash")).json().entries.length, 0);
  }
  const { s, c, dir } = await setup();
  const d = await newDrawing(c);
  await c.del(`/api/notes/${d.id}`);
  const { c: c2 } = await crashAt(s, "empty:moved", { method: "POST", url: "/api/trash/empty", body: { ids: [d.id] } }, c.cookie);
  assert.equal((await c2.get("/api/trash")).json().entries.length, 0);
  assert.deepEqual(await ls(path.join(dir, "tmp")), []);
});

test("a drawing's save, stopped after each step: the old drawing or the new one", async () => {
  for (const [stepName, newer] of [["save:history", false], ["save:replaced", true]] as const) {
    const { s, c } = await setup();
    const d = await newDrawing(c);
    const old = scene([rect("a", 1)]);
    const next = scene([rect("a", 2)]);
    const r = await saveDrawing(c, d.id, old, d.revision);
    const { c: c2 } = await crashAt(s, stepName, { method: "PUT", url: `/api/notes/${d.id}`, text: next, headers: { "content-type": DRAWING_TYPE, "if-match": r.json().revision } }, c.cookie);
    const got = (await c2.get(`/api/notes/${d.id}`)).json();
    const want = newer ? next : old;
    assert.equal(got.text, want, stepName);
    assert.equal((await c2.get(`/api/notes/${d.id}/history`)).json().versions.length, 2, "at worst one extra history file");
    assert.equal((await saveDrawing(c2, d.id, scene([rect("a", 3)]), sha(want))).statusCode, 200);
  }
});

test("review 18-4: a note saved as new from a drawing's id takes no photos, so its photos are missing", async () => {
  const { c } = await setup();
  const d = await newDrawing(c);
  const r = await c.saveAsNew("# From a draft\n\n![p](note.assets/p.png)\n", d.id);
  assert.equal(r.statusCode, 201, r.body);
  assert.equal(r.json().photosMissing, true, "a drawing is not a note's source of photos");
  const n = await c.create("Has photos");
  assert.equal((await c.saveAsNew("![p](note.assets/p.png)\n", n.id)).json().photosMissing, false, "a note source still counts");
});
