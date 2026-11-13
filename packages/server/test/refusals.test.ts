// Finding 44 of the version 2 code review: server refusals that had no test. A font file on a
// host that is not Google's; the 20-second limit; X-Forwarded-For trusted only from Caddy; an
// IPv6 address counting as its /64; the hash queue's 429; the failure table's size; 401 on every
// route that needs a session; the catalogue being unavailable.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { LIMITS, routes, type RouteDef } from "../../contract/src/index.ts";
import { FAIL_TABLE_MAX, FailureTable, HASH_RUNNING, HASH_WAITING } from "../src/accounts.ts";
import { FETCH_TIMEOUT_MS } from "../src/fonts.ts";
import { fakeGoogle } from "./fakegoogle.ts";
import { Client, HOST, PASSWORD, startServer, userDir } from "./http.ts";

const WRONG = "a wrong password here";

async function withGoogle(over: Parameters<typeof startServer>[0] = {}) {
  const google = await fakeGoogle();
  const s = await startServer({ google: { list: google.base, css: google.base, files: google.base }, googleInsecure: true, ...over });
  await s.ctx.addUser("alice", PASSWORD);
  const alice = new Client(s.app);
  await alice.login("alice");
  return { google, s, alice };
}

test("a font file on a host that is not Google's is not fetched", async () => {
  const { google, s, alice } = await withGoogle();
  const other = await fakeGoogle();
  google.mode.foreign = other.base;
  const r = await alice.post("/api/fonts", { slug: "caveat" });
  assert.equal(r.statusCode, 502, r.body);
  assert.deepEqual(other.requests, [], "nothing was asked of the other host");
  assert.deepEqual((await alice.get("/api/fonts")).json().fonts, []);
  assert.deepEqual(await fs.readdir(path.join(userDir(s, "alice"), "tmp")), []);
  await other.close();
  await google.close();
});

test("a fetch from Google that takes too long is given up (20 seconds; shorter here)", async () => {
  assert.equal(FETCH_TIMEOUT_MS, 20_000);
  const { google, alice } = await withGoogle({ fontFetchMs: 300 });
  google.mode.slow = true;
  const t0 = Date.now();
  const r = await alice.post("/api/fonts", { slug: "caveat" });
  assert.equal(r.statusCode, 504, r.body);
  assert.ok(Date.now() - t0 < 5000);
  google.mode.slow = false;
  await google.close();
});

test("the catalogue being unavailable: the answer says so, it is not an error", async () => {
  for (const mode of ["listDown", "listLarge", "listChanged"] as const) {
    const { google, alice } = await withGoogle();
    google.mode[mode] = true;
    const r = await alice.get("/api/fonts/catalogue");
    assert.equal(r.statusCode, 200, `${mode}: ${r.body}`);
    assert.deepEqual(r.json(), { families: [], total: 0, categories: [], available: false }, mode);
    // Adding a font then is refused, not half done.
    assert.notEqual((await alice.post("/api/fonts", { slug: "caveat" })).statusCode, 200, mode);
    google.mode[mode] = false;
    assert.equal((await alice.get("/api/fonts/catalogue")).json().available, true, `${mode}: it is tried again`);
    await google.close();
  }
});

/** Logins with a wrong password, then the right one, from one address; the last status. */
async function fiveWrongThenRight(c: Client, headers: Record<string, string> = {}): Promise<number> {
  for (let i = 0; i < 5; i++) await c.req("POST", "/api/login", { username: "alice", password: WRONG }, headers);
  return (await c.req("POST", "/api/login", { username: "alice", password: PASSWORD }, headers)).statusCode;
}

test("X-Forwarded-For is trusted only from Caddy", async () => {
  const s = await startServer({ trustedProxy: "127.0.0.1" });
  await s.ctx.addUser("alice", PASSWORD);
  // Through Caddy: the address it sends is the client's; another client is not blocked.
  const caddy = new Client(s.app);
  caddy.ip = "127.0.0.1";
  assert.equal(await fiveWrongThenRight(caddy, { "x-forwarded-for": "203.0.113.50" }), 429);
  assert.equal((await caddy.req("POST", "/api/login", { username: "alice", password: PASSWORD }, { "x-forwarded-for": "203.0.113.51" })).statusCode, 200);
  // Not from Caddy: a client's own X-Forwarded-For is ignored, so it cannot change its address.
  const direct = new Client(s.app);
  direct.ip = "198.51.100.20";
  for (let i = 0; i < 5; i++) await direct.req("POST", "/api/login", { username: "alice", password: WRONG }, { "x-forwarded-for": `192.0.2.${i}` });
  assert.equal((await direct.req("POST", "/api/login", { username: "alice", password: PASSWORD }, { "x-forwarded-for": "192.0.2.99" })).statusCode, 429);
});

test("an IPv6 address counts as its /64", async () => {
  const s = await startServer();
  await s.ctx.addUser("alice", PASSWORD);
  const a = new Client(s.app);
  a.ip = "2001:db8:1:2::1";
  assert.equal(await fiveWrongThenRight(a), 429);
  const sameNet = new Client(s.app);
  sameNet.ip = "2001:db8:1:2:ffff:ffff:ffff:ffff";
  assert.equal((await sameNet.login("alice")).statusCode, 429, "the same /64");
  const otherNet = new Client(s.app);
  otherNet.ip = "2001:db8:1:3::1";
  assert.equal((await otherNet.login("alice")).statusCode, 200, "another /64");
});

test("the hash queue: two hashes at once and ten waiting; beyond that 429", async () => {
  const s = await startServer();
  await s.ctx.addUser("alice", PASSWORD);
  // Each from its own address, so the failure limit does not apply.
  const n = HASH_RUNNING + HASH_WAITING + 4;
  const answers = await Promise.all(
    Array.from({ length: n }, (_, i) => {
      const c = new Client(s.app);
      c.ip = `203.0.113.${100 + i}`;
      return c.req("POST", "/api/login", { username: "alice", password: WRONG });
    }),
  );
  const busy = answers.filter((r) => r.statusCode === 429);
  assert.equal(answers.filter((r) => r.statusCode === 401).length, HASH_RUNNING + HASH_WAITING);
  assert.equal(busy.length, n - HASH_RUNNING - HASH_WAITING);
  assert.match(busy[0].json().error.message, /at once/);
});

test("the failure table holds at most 10,000 entries, dropping the oldest", () => {
  const t = new FailureTable();
  for (let i = 0; i <= FAIL_TABLE_MAX + 50; i++) t.fail(`user${i}`, "203.0.113.1");
  assert.equal(t.size, FAIL_TABLE_MAX);
  for (let i = 0; i < 4; i++) t.fail(`user${FAIL_TABLE_MAX + 50}`, "203.0.113.1");
  assert.equal(t.blocked(`user${FAIL_TABLE_MAX + 50}`, "203.0.113.1"), true, "the newest is kept");
  for (let i = 0; i < 4; i++) t.fail("user0", "203.0.113.1");
  assert.equal(t.blocked("user0", "203.0.113.1"), false, "the oldest was dropped");
});

test("every route that needs a session answers 401 without one", async () => {
  const s = await startServer();
  const c = new Client(s.app);
  const fill = (url: string) =>
    url.replace(":id", "a".repeat(url.startsWith("/api/agents/") ? 16 : 24)).replace(":version", "2026-11-10T14-02-11.512Z-k3fa").replace(":file", url.startsWith("/api/fonts/") ? "1.woff2" : "p.png").replace(":name", "S").replace(":slug", "caveat");
  let checked = 0;
  for (const [name, def] of Object.entries(routes) as [string, RouteDef][]) {
    if (def.auth !== "session") continue;
    // "document" is SPEC-DRAWINGS 5's name for the body of a save (a note's Markdown here).
    const doc = def.body === "markdown" || def.body === "document";
    const headers: Record<string, string> = doc ? { "content-type": "text/markdown", "if-match": "a".repeat(64) } : def.body === "multipart" ? { "content-type": "multipart/form-data; boundary=x" } : {};
    // Valid bodies: a body that does not match its schema is refused with 400 first.
    const json: Record<string, unknown> = {
      password: { current: "x", next: "y".repeat(LIMITS.passwordMin) },
      empty: { ids: [] },
      styleSave: { style: { name: "S", bold: true, italic: false, underline: false, strike: false, size: null, font: null, color: null, bg: null } },
      fontAdd: { slug: "caveat" },
      agentMake: { name: "claude" },
    };
    const body = def.method === "GET" || def.method === "DELETE" ? undefined : doc ? "text" : def.body === "multipart" ? "--x--\r\n" : (json[name] ?? {});
    const r = await c.req(def.method, fill(def.url), body, headers);
    assert.equal(r.statusCode, 401, `${name} ${def.method} ${def.url}: ${r.statusCode} ${r.body}`);
    checked++;
  }
  assert.ok(checked >= 25, `${checked} routes`);
  void HOST;
});
