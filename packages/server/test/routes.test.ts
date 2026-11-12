// SPEC2 12, server: every route and every refusal (fastify.inject on a temporary folder).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { Client, ORIGIN, PASSWORD, startServer, twoUsers, userDir } from "./http.ts";

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

test("login, me, logout, and the session cookie", async () => {
  const s = await startServer();
  await s.ctx.addUser("alice", PASSWORD);
  const c = new Client(s.app);
  assert.equal((await c.get("/api/me")).statusCode, 401);
  const bad = await c.login("alice", "wrong password here");
  assert.equal(bad.statusCode, 401);
  assert.equal(bad.json().error.code, "wrong-login");
  const r = await c.login("alice");
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().user.username, "alice");
  const cookie = r.cookies.find((x) => x.name === "notes_session")!;
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.secure, true);
  assert.equal(cookie.sameSite, "Lax");
  assert.equal(cookie.maxAge, 30 * 24 * 3600);
  const me = await c.get("/api/me");
  assert.equal(me.statusCode, 200);
  assert.deepEqual(me.json(), { user: { id: s.ctx.accounts.byName("alice")!.id, username: "alice" }, lastBackup: null });
  assert.equal(me.headers["cache-control"], "no-store");
  assert.equal(me.headers["referrer-policy"], "no-referrer");
  assert.equal((await c.post("/api/logout")).statusCode, 200);
  assert.equal((await c.get("/api/me")).statusCode, 401);
});

test("requests that do not match their schema are refused with 400", async () => {
  const { alice } = await twoUsers();
  assert.equal((await alice.post("/api/login", { username: "x" })).statusCode, 400);
  assert.equal((await alice.post("/api/login", { username: "", password: "p" })).statusCode, 400);
  assert.equal((await alice.get("/api/notes/notanid")).statusCode, 400);
  assert.equal((await alice.get("/api/notes/aaaaaaaaaaaaaaaaaaaaaaa1")).statusCode, 400, "1 is not base-32");
  assert.equal((await alice.post("/api/trash/empty", { ids: ["x"] })).statusCode, 400);
  assert.equal((await alice.post("/api/notes", { title: 5 })).statusCode, 400);
  const n = await alice.create("x");
  assert.equal((await alice.req("PUT", `/api/notes/${n.id}`, Buffer.from("t"), { "content-type": "text/markdown" })).statusCode, 400, "no If-Match");
  assert.equal((await alice.req("PUT", `/api/notes/${n.id}`, Buffer.from("t"), { "content-type": "text/markdown", "if-match": "abc" })).statusCode, 400);
  const e = await alice.post("/api/login", { username: "x" });
  assert.equal(e.json().error.code, "bad-request");
  assert.equal(typeof e.json().error.message, "string");
});

test("a changing request needs this site's Origin and a JSON, Markdown or multipart body", async () => {
  const { alice } = await twoUsers();
  const n = await alice.create("x");
  assert.equal((await alice.req("DELETE", `/api/notes/${n.id}`, undefined, { origin: "https://evil.example" })).statusCode, 403);
  assert.equal((await alice.req("DELETE", `/api/notes/${n.id}`, undefined, { origin: "" })).statusCode, 403);
  assert.equal((await alice.req("POST", "/api/notes", "title=x", { "content-type": "application/x-www-form-urlencoded" })).statusCode, 415);
  assert.equal((await alice.req("POST", "/api/notes", "x", { "content-type": "text/plain" })).statusCode, 415);
  assert.equal((await alice.req("PUT", `/api/notes/${n.id}`, { text: "x" }, { "if-match": n.revision })).statusCode, 415, "a save is text/markdown");
  assert.equal((await alice.req("POST", "/api/password", "x", { "content-type": "text/markdown" })).statusCode, 415);
  // A GET changes nothing and needs no Origin.
  assert.equal((await alice.get(`/api/notes/${n.id}`)).statusCode, 200);
});

test("create, read, list, search, tags", async () => {
  const { alice } = await twoUsers();
  const a = await alice.create("Shopping");
  assert.match(a.id, /^[a-z2-7]{24}$/);
  assert.match(a.text, /^---\ntitle: "Shopping"\ncreated: \d{4}-\d\d-\d\d\n---\n\n$/);
  assert.equal(a.revision, sha(a.text));
  const u1 = await alice.create();
  const u2 = await alice.create("   ");
  assert.equal((await alice.get(`/api/notes/${u1.id}`)).json().entry.title, "Untitled 1");
  assert.equal((await alice.get(`/api/notes/${u2.id}`)).json().entry.title, "Untitled 2");
  const q = await alice.create('A "quoted"\\ title\nwith\tbreaks');
  assert.ok(q.text.includes('title: "A \\"quoted\\"\\\\ title with breaks"'), q.text);
  const long = await alice.create("x".repeat(400));
  assert.equal((await alice.get(`/api/notes/${long.id}`)).json().entry.title.length, 300);
  // Save tags and text.
  const r = await alice.save(a.id, '---\ntitle: "Shopping"\ntags: [home, food]\n---\n\nMilk and **eggs** for the week.\n', a.revision);
  assert.equal(r.statusCode, 200, r.body);
  const b = await alice.create("Work plan");
  await alice.save(b.id, "---\ntags: [work]\n---\n\n# Work plan\n\nShip the eggs report.\n", b.revision);
  const list = (await alice.get("/api/notes")).json();
  assert.equal(list.entries.length, 6);
  assert.equal(list.entries[0].id, b.id, "newest first");
  assert.deepEqual(list.tags, [{ tag: "food", count: 1 }, { tag: "home", count: 1 }, { tag: "work", count: 1 }]);
  const byTag = (await alice.get("/api/notes?tag=work")).json();
  assert.deepEqual(byTag.entries.map((e: { id: string }) => e.id), [b.id]);
  assert.equal(byTag.tags.length, 3, "tag counts are always of all live notes");
  const found = (await alice.get("/api/notes?q=EGGS")).json();
  assert.equal(found.entries.length, 2);
  assert.ok(found.entries.every((e: { excerpt?: string }) => typeof e.excerpt === "string" && e.excerpt.toLowerCase().includes("eggs")));
  const both = (await alice.get("/api/notes?q=eggs&tag=home")).json();
  assert.deepEqual(both.entries.map((e: { id: string }) => e.id), [a.id], "tag and q together");
  assert.equal((await alice.get("/api/notes?q=work")).json().entries.length, 1, "search covers tags and titles");
  const read = (await alice.get(`/api/notes/${b.id}`)).json();
  assert.equal(read.entry.title, "Work plan", "the first level-1 heading");
  assert.deepEqual(read.entry.tags, ["work"]);
});

test("save: 409 with the current text, 410 in the trash, 404 unknown, 422 refused, 413 too large", async () => {
  const { alice } = await twoUsers();
  const n = await alice.create("Note");
  const first = await alice.save(n.id, "one\n", n.revision);
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().revision, sha("one\n"));
  const stale = await alice.save(n.id, "two\n", n.revision);
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().current.text, "one\n");
  assert.equal(stale.json().current.revision, sha("one\n"));
  assert.equal(stale.json().current.entry.id, n.id);
  assert.equal((await alice.save(n.id, Buffer.from([0xff, 0xfe, 0x41]), sha("one\n"))).statusCode, 422);
  const broken = await alice.save(n.id, "---\n: [\n---\n\nx\n", sha("one\n"));
  assert.equal(broken.statusCode, 422);
  assert.equal(broken.json().error.code, "broken-front-matter");
  assert.equal((await alice.save(n.id, "x".repeat(2 * 1024 * 1024 + 1), sha("one\n"))).statusCode, 413);
  assert.equal((await alice.save(n.id, "x".repeat(2 * 1024 * 1024), sha("one\n"))).statusCode, 200, "2 MB exactly fits");
  const same = await alice.save(n.id, "x".repeat(2 * 1024 * 1024), sha("x".repeat(2 * 1024 * 1024)));
  assert.equal(same.statusCode, 200, "equal bytes: the current revision");
  assert.equal((await alice.get(`/api/notes/${n.id}/history`)).json().versions.length, 2, "equal bytes wrote nothing");
  assert.equal((await alice.save("aaaaaaaaaaaaaaaaaaaaaaaa", "x", sha("x"))).statusCode, 404);
  assert.equal((await alice.del(`/api/notes/${n.id}`)).statusCode, 200);
  assert.equal((await alice.save(n.id, "y", sha("x"))).statusCode, 410);
  assert.equal((await alice.get(`/api/notes/${n.id}`)).statusCode, 410);
});

test("the server never changes the bytes of a save: a byte order mark and CRLF survive", async () => {
  const { alice } = await twoUsers();
  const n = await alice.create("x");
  const text = "\ufeff---\r\ntitle: Crlf\r\n---\r\n\r\nLine one\r\nLine two\r\n";
  const r = await alice.save(n.id, text, n.revision);
  assert.equal(r.statusCode, 200);
  const back = (await alice.get(`/api/notes/${n.id}`)).json();
  assert.equal(back.text, text);
  assert.equal(back.revision, sha(Buffer.from(text, "utf8")));
});

test("history: saved versions, newest first, at most 50; a version's text", async () => {
  const { alice, s } = await twoUsers();
  const n = await alice.create("H");
  let rev = n.revision;
  for (let i = 0; i < 53; i++) {
    const r = await alice.save(n.id, `version ${i}\n`, rev);
    rev = r.json().revision;
  }
  const v = (await alice.get(`/api/notes/${n.id}/history`)).json().versions;
  assert.equal(v.length, 50);
  assert.ok(v[0].version > v[1].version);
  assert.match(v[0].time, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  const t = (await alice.get(`/api/notes/${n.id}/history/${v[0].version}`)).json().text;
  assert.equal(t, "version 51\n");
  assert.equal((await alice.get(`/api/notes/${n.id}/history/2026-01-01T00-00-00.000Z-aaaa`)).statusCode, 404);
  assert.equal((await alice.get(`/api/notes/${n.id}/history/..%2F..%2Fx`)).statusCode, 400);
  const files = await fs.readdir(path.join(userDir(s, "alice"), "notes", n.id, "history"));
  assert.equal(files.length, 50);
});

test("trash: move, list, read, restore, empty one, empty all", async () => {
  const { alice, s } = await twoUsers();
  const a = await alice.create("Alpha");
  const b = await alice.create("Beta");
  assert.equal((await alice.del(`/api/notes/${a.id}`)).statusCode, 200);
  assert.equal((await alice.del(`/api/notes/${a.id}`)).statusCode, 410);
  assert.equal((await alice.del("/api/notes/aaaaaaaaaaaaaaaaaaaaaaaa")).statusCode, 404);
  const t = (await alice.get("/api/trash")).json().entries;
  assert.equal(t.length, 1);
  assert.equal(t[0].id, a.id);
  assert.equal(t[0].title, "Alpha");
  assert.match(t[0].trashed, /^\d{4}-/);
  assert.equal((await alice.get(`/api/trash/${a.id}`)).json().text, a.text);
  assert.equal((await alice.get(`/api/trash/${b.id}`)).statusCode, 404);
  assert.equal((await alice.get("/api/notes")).json().entries.length, 1);
  const r = await alice.post(`/api/trash/${a.id}/restore`);
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().entry.id, a.id);
  assert.equal((await alice.post(`/api/trash/${a.id}/restore`)).statusCode, 404);
  assert.deepEqual(await fs.readdir(path.join(userDir(s, "alice"), "notes", a.id)), ["note.md"], "trashed.json goes on restore");
  await alice.del(`/api/notes/${a.id}`);
  await alice.del(`/api/notes/${b.id}`);
  const one = await alice.post("/api/trash/empty", { ids: [a.id, "aaaaaaaaaaaaaaaaaaaaaaaa"] });
  assert.deepEqual(one.json().removed, [a.id]);
  assert.equal((await alice.get("/api/trash")).json().entries.length, 1);
  const all = await alice.post("/api/trash/empty", { ids: [b.id] });
  assert.deepEqual(all.json().removed, [b.id]);
  assert.deepEqual(await fs.readdir(path.join(userDir(s, "alice"), "trash")), []);
  assert.deepEqual(await fs.readdir(path.join(userDir(s, "alice"), "tmp")), []);
});

test("save as a new note: the text, and the source's photos copied as new files", async () => {
  const { alice, s } = await twoUsers();
  const a = await alice.create("Has photo");
  const assets = path.join(userDir(s, "alice"), "notes", a.id, "note.assets");
  await fs.mkdir(assets);
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  await fs.writeFile(path.join(assets, "cat.png"), png);
  const text = "![](note.assets/cat.png)\n";
  const r = await alice.saveAsNew(text, a.id);
  assert.equal(r.statusCode, 201, r.body);
  const n = r.json();
  assert.equal(n.photosMissing, false);
  assert.equal(n.text, text);
  const copy = path.join(userDir(s, "alice"), "notes", n.id, "note.assets", "cat.png");
  assert.deepEqual(await fs.readFile(copy), png);
  const st1 = await fs.stat(copy);
  const st2 = await fs.stat(path.join(assets, "cat.png"));
  assert.notEqual(st1.ino, st2.ino, "a copy is a new file, never a link");
  // From the trash too.
  await alice.del(`/api/notes/${a.id}`);
  assert.equal((await alice.saveAsNew(text, a.id)).json().photosMissing, false);
  // A source that is gone.
  await alice.post("/api/trash/empty", { ids: [a.id] });
  assert.equal((await alice.saveAsNew(text, a.id)).json().photosMissing, true);
  assert.equal((await alice.saveAsNew("no photos\n", a.id)).json().photosMissing, false);
  assert.equal((await alice.saveAsNew("---\n: [\n---\n", a.id)).statusCode, 422);
});

test("saved styles: save, replace, rename, delete, the limit of 50", async () => {
  const { alice } = await twoUsers();
  const st = (name: string, over = {}) => ({ name, bold: true, italic: false, underline: false, strike: false, size: 14, font: null, color: "red", bg: null, ...over });
  assert.deepEqual((await alice.get("/api/styles")).json(), { styles: [] });
  let r = await alice.req("PUT", "/api/styles/Loud", { style: st("Loud") });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().styles.length, 1);
  r = await alice.req("PUT", "/api/styles/Loud", { style: st("Loud", { color: "blue" }) });
  assert.equal(r.json().styles[0].color, "blue", "replaced");
  r = await alice.req("PUT", "/api/styles/Quiet", { style: st("Quiet"), renameFrom: "Loud" });
  assert.deepEqual(r.json().styles.map((x: { name: string }) => x.name), ["Quiet"], "renamed in one step");
  assert.equal((await alice.req("PUT", "/api/styles/Other", { style: st("Other"), renameFrom: "Nope" })).statusCode, 404);
  await alice.req("PUT", "/api/styles/Second", { style: st("Second") });
  assert.equal((await alice.req("PUT", "/api/styles/Second", { style: st("Second"), renameFrom: "Quiet" })).statusCode, 409);
  assert.equal((await alice.req("PUT", "/api/styles/Bad", { style: st("Bad", { color: "url(x)" }) })).statusCode, 400);
  assert.equal((await alice.req("PUT", "/api/styles/Bad", { style: st("Bad", { size: 401 }) })).statusCode, 400);
  for (let i = 0; i < 48; i++) await alice.req("PUT", `/api/styles/s${i}`, { style: st(`s${i}`) });
  assert.equal((await alice.get("/api/styles")).json().styles.length, 50);
  assert.equal((await alice.req("PUT", "/api/styles/one-more", { style: st("one-more") })).statusCode, 409);
  assert.equal((await alice.del("/api/styles/Quiet")).statusCode, 200);
  assert.equal((await alice.del("/api/styles/Quiet")).statusCode, 404);
});

test("password change: needs the current one, counted in the login limit, ends other sessions", async () => {
  const { s, alice } = await twoUsers();
  const other = new Client(s.app);
  await other.login("alice");
  assert.equal((await alice.post("/api/password", { current: "not the password", next: "a new long password" })).statusCode, 422);
  assert.equal((await alice.post("/api/password", { current: PASSWORD, next: "four" })).statusCode, 400, "under 5 characters");
  assert.equal((await alice.post("/api/password", { current: PASSWORD, next: "a new long password" })).statusCode, 200);
  assert.equal((await alice.get("/api/me")).statusCode, 200, "this session stays");
  assert.equal((await other.get("/api/me")).statusCode, 401, "others end");
  assert.equal((await new Client(s.app).login("alice", "a new long password")).statusCode, 200);
  // Wrong current passwords count toward the login limit.
  for (let i = 0; i < 5; i++) await alice.post("/api/password", { current: "wrong wrong wrong", next: "a new long password" });
  assert.equal((await new Client(s.app).login("alice", "a new long password")).statusCode, 429);
});

test("login limits: 5 failures in 15 minutes block the pair of username and address", async () => {
  const s = await startServer();
  await s.ctx.addUser("alice", PASSWORD);
  const c = new Client(s.app);
  for (let i = 0; i < 5; i++) assert.equal((await c.login("alice", "wrong password!!")).statusCode, 401);
  assert.equal((await c.login("alice")).statusCode, 429);
  const elsewhere = new Client(s.app);
  elsewhere.ip = "192.0.2.1";
  assert.equal((await elsewhere.login("alice")).statusCode, 200, "another address is not blocked");
  assert.equal((await c.login("nobody", "wrong password!!")).statusCode, 401, "an unknown name is checked against a dummy hash");
  const big = await c.req("POST", "/api/login", { username: "alice", password: "x".repeat(1100) });
  assert.equal(big.statusCode, 413, "login bodies are at most 1 KB");
});

test("the page: every address of 9.1 with a fresh nonce and the policy; unknown addresses", async () => {
  const s = await startServer();
  const c = new Client(s.app);
  const nonces = new Set<string>();
  for (const p of ["/", "/login", "/n/aaaaaaaaaaaaaaaaaaaaaaaa", "/n/aaaaaaaaaaaaaaaaaaaaaaaa/history", "/trash", "/fonts", "/styles", "/account"]) {
    const r = await c.get(p);
    assert.equal(r.statusCode, 200, p);
    assert.match(r.headers["content-type"] as string, /text\/html/);
    const csp = r.headers["content-security-policy"] as string;
    assert.ok(csp.includes("default-src 'none'; script-src 'self'; style-src-elem 'self' 'nonce-"), csp);
    assert.ok(csp.includes("style-src-attr 'unsafe-inline'; img-src 'self' blob:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"));
    const nonce = /'nonce-([^']+)'/.exec(csp)![1];
    assert.ok(r.body.includes(`content="${nonce}"`), "the nonce is in the page");
    nonces.add(nonce);
  }
  assert.equal(nonces.size, 8, "a fresh nonce each time");
  assert.equal((await c.get("/no/such/place")).statusCode, 404);
  assert.match((await c.get("/no/such/place")).headers["content-type"] as string, /text\/html/);
  assert.equal((await c.get("/api/nothing")).json().error.code, "not-found");
  const fav = await c.get("/favicon.svg");
  assert.equal(fav.statusCode, 200);
  assert.equal((await c.get("/assets/../package.json")).statusCode, 404);
});

test("logs hold the method, route pattern, status and time, never a query string or body", async () => {
  const { s, alice } = await twoUsers();
  const n = await alice.create("Secret title");
  await alice.get("/api/notes?q=secretword");
  await alice.save(n.id, "my secret text", n.revision);
  const joined = s.logs.join("\n");
  assert.ok(joined.includes("GET /api/notes 200"));
  assert.ok(!joined.includes("secretword") && !joined.includes("Secret title") && !joined.includes("my secret text") && !joined.includes(PASSWORD));
  void ORIGIN;
});
