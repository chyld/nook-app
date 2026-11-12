// Findings of the version 2 code review (sections 2 and 3) in the server: fastify.inject on a
// temporary folder. Each test names its finding.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Client, HOST, PASSWORD, startServer } from "./http.ts";

/** A client that reaches the app through Caddy: from Caddy's address, with its headers. */
function viaCaddy(c: Client, proto: string): Record<string, string> {
  c.ip = "127.0.0.1";
  return { "x-forwarded-proto": proto, "x-forwarded-for": "203.0.113.7" };
}

test("10: a change is refused unless Origin has the site's scheme as well as its host and port", async () => {
  // Behind Caddy, which tells the app the scheme the browser used.
  const s = await startServer({ trustedProxy: "127.0.0.1" });
  await s.ctx.addUser("alice", PASSWORD);
  const c = new Client(s.app);
  const h = viaCaddy(c, "https");
  const login = await c.req("POST", "/api/login", { username: "alice", password: PASSWORD }, { ...h, origin: `https://${HOST}` });
  assert.equal(login.statusCode, 200);
  c.cookie = login.cookies.find((x) => x.name === "notes_session")!.value;
  assert.equal((await c.req("POST", "/api/notes", {}, { ...h, origin: `http://${HOST}` })).statusCode, 403, "http for an https site");
  assert.equal((await c.req("POST", "/api/notes", {}, { ...h, origin: `https://${HOST}:8443` })).statusCode, 403, "another port");
  assert.equal((await c.req("POST", "/api/notes", {}, { ...h, origin: `https://${HOST}` })).statusCode, 201);
  // Without a proxy the scheme is the request's own.
  const d = await startServer();
  await d.ctx.addUser("alice", PASSWORD);
  const e = new Client(d.app);
  assert.equal((await e.req("POST", "/api/login", { username: "alice", password: PASSWORD }, { origin: `https://${HOST}` })).statusCode, 403);
  assert.equal((await e.req("POST", "/api/login", { username: "alice", password: PASSWORD }, { origin: `http://${HOST}` })).statusCode, 200);
});

import { sfs } from "../src/safefs.ts";
import { SESSION_COOKIE } from "../src/app.ts";

/** Runs `op` with deleting a session file failing as a crash would stop it; then a fresh server
 *  on the same folder. */
async function crashDeletingSessions(s: Awaited<ReturnType<typeof startServer>>, op: () => Promise<unknown>) {
  const rm = sfs.rm;
  sfs.rm = async (p, o) => {
    if (String(p).includes(`${"/"}sessions${"/"}`)) throw new Error("crash");
    return rm(p, o);
  };
  try {
    await op().catch(() => {});
  } finally {
    sfs.rm = rm;
  }
  await s.app.close();
  return startServer({}, s.root);
}

const NEW = "a brand new password";

for (const how of ["change", "reset"] as const) {
  test(`11: a crash during a password ${how} never leaves the other sessions alive with the new password`, async () => {
    const s = await startServer();
    await s.ctx.addUser("alice", PASSWORD);
    const mine = new Client(s.app);
    const other = new Client(s.app);
    other.ip = "198.51.100.9";
    await mine.login("alice");
    await other.login("alice");
    const s2 = await crashDeletingSessions(s, () =>
      how === "change" ? mine.req("POST", "/api/password", { current: PASSWORD, next: NEW }).then((r) => assert.notEqual(r.statusCode, 200)) : s.ctx.accounts.resetPassword("alice", NEW),
    );
    const again = new Client(s2.app);
    const changed = (await again.login("alice", NEW)).statusCode === 200;
    other.app = s2.app;
    const otherAlive = (await other.get("/api/me")).statusCode === 200;
    assert.ok(!(changed && otherAlive), `the new password works (${changed}) and another session is alive (${otherAlive})`);
    void SESSION_COOKIE;
  });
}

test("12: a burst of concurrent wrong guesses runs at most the 5 the limit allows", async () => {
  const s = await startServer();
  await s.ctx.addUser("alice", PASSWORD);
  const c = new Client(s.app);
  const answers = await Promise.all(Array.from({ length: 12 }, (_, i) => c.req("POST", "/api/login", { username: "alice", password: `wrong guess number ${i}` })));
  const guessed = answers.filter((r) => r.statusCode === 401).length;
  assert.ok(guessed <= 5, `${guessed} guesses were checked`);
  assert.ok(answers.every((r) => r.statusCode === 401 || r.statusCode === 429));
  // The right password from that address is now refused too, for 15 minutes.
  assert.equal((await c.login("alice")).statusCode, 429);
});

import { Readable } from "node:stream";
import sharp from "sharp";
import { multipart, twoUsers } from "./http.ts";
import { PROCESS_AT_ONCE } from "../src/photos.ts";

test("13: an upload's body is not read into memory until it may be processed", async () => {
  const { alice } = await twoUsers();
  const n = await alice.create("P");
  // Slow enough to process that the uploads overlap.
  const img = await sharp({ create: { width: 2000, height: 2000, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 40 } } }).png({ compressionLevel: 1 }).toBuffer();
  const m = multipart("p.png", img, "image/png");
  const read: number[] = [];
  const answered: number[] = [];
  const jobs = Array.from({ length: 6 }, async (_, i) => {
    // In small pieces, each given only when the reader asks for it: the last is asked for when
    // the body has been read.
    let at = 0;
    const body = new Readable({
      highWaterMark: 16 * 1024,
      read() {
        if (at >= m.body.length) {
          read[i] ??= performance.now();
          this.push(null);
          return;
        }
        this.push(m.body.subarray(at, at + 16 * 1024));
        at += 16 * 1024;
      },
    });
    const r = await alice.app.inject({ method: "POST", url: `/api/notes/${n.id}/photos`, headers: { host: "notes.test", origin: "http://notes.test", cookie: `notes_session=${alice.cookie}`, ...m.headers, "content-length": String(m.body.length) }, payload: body, remoteAddress: alice.ip });
    answered[i] = performance.now();
    assert.equal(r.statusCode, 200, r.body);
  });
  await Promise.all(jobs);
  // The most bodies held at once: read, and not yet answered. One more than the slots, as the
  // next body may be read in the moment between a slot coming free and its answer arriving here.
  let most = 0;
  for (const t of read) most = Math.max(most, read.filter((x, j) => x <= t && answered[j] > t).length);
  assert.ok(most <= PROCESS_AT_ONCE + 1, `${most} bodies were held at once`);
});

import * as fsp from "node:fs/promises";
import { fileURLToPath } from "node:url";

/** One service's block of compose.yaml, as text. */
async function composeService(name: string): Promise<string> {
  const text = await fsp.readFile(fileURLToPath(new URL("../../../compose.yaml", import.meta.url)), "utf8");
  const m = new RegExp(`^  ${name}:\\n((?:    .*\\n|\\s*\\n)*)`, "m").exec(text);
  assert.ok(m, `no service ${name}`);
  return m[1];
}

test("15: the Caddy container, which is published, is hardened like the app's", async () => {
  const caddy = await composeService("caddy");
  assert.match(caddy, /^    read_only: true$/m);
  assert.match(caddy, /^    cap_drop: \[ALL\]$/m);
  assert.match(caddy, /^    cap_add: \[NET_BIND_SERVICE\]$/m, "only what binding 80 and 443 needs");
  assert.match(caddy, /^    security_opt: \["no-new-privileges:true"\]$/m);
  assert.match(caddy, /^    tmpfs:\n      - \/tmp/m);
});

import { constants as fsc } from "node:fs";
import path from "node:path";
import { userDir } from "./http.ts";
import { LIMITS } from "../../contract/src/index.ts";

/** Records the folders synced (opened as folders) while `op` runs. */
async function synced(op: () => Promise<unknown>): Promise<string[]> {
  const open = sfs.open;
  const dirs: string[] = [];
  sfs.open = async (p, flags, mode) => {
    if (flags & fsc.O_DIRECTORY) dirs.push(path.resolve(String(p)));
    return open(p, flags, mode);
  };
  try {
    await op();
  } finally {
    sfs.open = open;
  }
  return dirs;
}

test("31: emptying the trash syncs both folders of the rename; trimming history syncs the history folder", async () => {
  const { s, alice } = await twoUsers();
  const n = await alice.create("T");
  assert.equal((await alice.del(`/api/notes/${n.id}`)).statusCode, 200);
  const dir = userDir(s, "alice");
  const dirs = await synced(() => alice.post("/api/trash/empty", { ids: [n.id] }));
  assert.ok(dirs.includes(path.join(dir, "trash")), "trash/");
  assert.ok(dirs.includes(path.join(dir, "tmp")), "tmp/, where the folder was renamed to");

  const m = await alice.create("H");
  let rev = m.revision;
  for (let i = 0; i <= LIMITS.history; i++) {
    const r = await alice.save(m.id, `version ${i}\n`, rev);
    rev = r.json().revision;
  }
  const hist = path.join(dir, "notes", m.id, "history");
  const last = await synced(async () => {
    const r = await alice.save(m.id, "the last\n", rev);
    assert.equal(r.statusCode, 200);
  });
  assert.equal((await fsp.readdir(hist)).length, LIMITS.history);
  assert.ok(last.filter((d) => d === hist).length >= 2, "history/ is synced after the new file and after the trimming");
});

test("32: a trashed note that is not valid UTF-8 is not read as empty text", async () => {
  const { s, alice } = await twoUsers();
  const n = await alice.create("T");
  await alice.del(`/api/notes/${n.id}`);
  await fsp.writeFile(path.join(userDir(s, "alice"), "trash", n.id, "note.md"), Buffer.from([0x66, 0xff, 0xfe, 0x0a]));
  const r = await alice.get(`/api/trash/${n.id}`);
  assert.equal(r.statusCode, 422, r.body);
  assert.equal(r.json().error.code, "not-utf8");
  // It is still listed, and can be restored or deleted.
  assert.deepEqual((await alice.get("/api/trash")).json().entries.map((e: { id: string }) => e.id), [n.id]);
});

test("34: POST /api/notes with JSON is checked against its schema and limited to 64 KB", async () => {
  const { alice } = await twoUsers();
  for (const body of ["null", "[]", '"x"', "3", '{"title":5}']) {
    const r = await alice.req("POST", "/api/notes", body, { "content-type": "application/json" });
    assert.equal(r.statusCode, 400, `${body}: ${r.body}`);
  }
  const padded = `{"title":"a"${" ".repeat(70 * 1024)}}`;
  assert.equal((await alice.req("POST", "/api/notes", padded, { "content-type": "application/json" })).statusCode, 413);
  // A body sent in chunks, without a length, is limited too.
  const chunked = await alice.app.inject({ method: "POST", url: "/api/notes", headers: { host: "notes.test", origin: "http://notes.test", cookie: `notes_session=${alice.cookie}`, "content-type": "application/json", "transfer-encoding": "chunked" }, payload: Readable.from([Buffer.from(padded)]), remoteAddress: alice.ip });
  assert.equal(chunked.statusCode, 413);
  // What a browser sends still works, and Save as new still takes 2 MB of Markdown.
  assert.equal((await alice.req("POST", "/api/notes", { title: "ok" })).statusCode, 201);
  assert.equal((await alice.req("POST", "/api/notes", "{}", { "content-type": "application/json" })).statusCode, 201);
  assert.equal((await alice.saveAsNew("x".repeat(LIMITS.noteBytes - 10))).statusCode, 201);
});

test("35d: saving a style keeps the entries of styles.json the app does not show", async () => {
  const { s, alice } = await twoUsers();
  const file = path.join(userDir(s, "alice"), "styles.json");
  const style = (name: string) => ({ name, bold: true, italic: false, underline: false, strike: false, size: null, font: null, color: null, bg: null });
  const odd = { name: "Odd", color: "not a colour!", note: "written by hand" };
  const list = [style("S0"), odd, ...Array.from({ length: 51 }, (_, i) => style(`S${i + 1}`))];
  await fsp.writeFile(file, JSON.stringify(list));
  const shown = (await alice.get("/api/styles")).json().styles;
  assert.equal(shown.length, LIMITS.styles, "50 are shown");
  // Replace one, rename one, delete one: the hidden entries stay as they were.
  assert.equal((await alice.req("PUT", "/api/styles/S0", { style: { ...style("S0"), italic: true } })).statusCode, 200);
  assert.equal((await alice.req("PUT", "/api/styles/T2", { style: style("T2"), renameFrom: "S2" })).statusCode, 200);
  assert.equal((await alice.del("/api/styles/S3")).statusCode, 200);
  const after = JSON.parse(await fsp.readFile(file, "utf8")) as { name: string }[];
  assert.deepEqual(after.find((x) => x.name === "Odd"), odd, "the entry that does not check is kept as written");
  assert.ok(after.some((x) => x.name === "S50") && after.some((x) => x.name === "S51"), "entries past the 50th are kept");
  assert.equal(after.length, list.length - 1);
  assert.equal((after.find((x) => x.name === "S0") as { italic?: boolean }).italic, true);
  // A file that does not parse is not replaced.
  await fsp.writeFile(file, "{ not json");
  const r = await alice.req("PUT", "/api/styles/New", { style: style("New") });
  assert.notEqual(r.statusCode, 200);
  assert.equal(await fsp.readFile(file, "utf8"), "{ not json");
});
