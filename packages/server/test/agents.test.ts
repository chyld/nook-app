// SPEC-AGENTS 9, server: tokens; the boundary of section 3; the interface of section 5 with each
// refusal and its hint; who wrote what (section 4), with the rule that an agent's request never
// removes a version a person wrote; the limits of 3.3; every curl example of the guide.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { AGENT_BASE, DRAWING_TYPE, LIMITS, MB, RE, routes, type RouteDef } from "../../contract/src/index.ts";
import { noteSpacing, serializeDrawing } from "../../core/src/index.ts";
import { renderNote } from "../../../noteformat/src/index.ts";
import { faults } from "../src/fsutil.ts";
import { Agents } from "../src/agents.ts";
import { Client, HOST, ls, ORIGIN, PASSWORD, startServer, type TestServer } from "./http.ts";

const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const today = () => new Date().toISOString().slice(0, 10);
const A = AGENT_BASE;

/** Requests as an agent sends them: a token, no cookie, and no Origin unless one is given. */
class AgentClient {
  app: FastifyInstance;
  token: string;
  constructor(app: FastifyInstance, token: string) {
    this.app = app;
    this.token = token;
  }
  req(method: string, url: string, body?: string | Buffer, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> {
    const h: Record<string, string> = { host: HOST, ...headers };
    if (this.token && !("authorization" in h)) h.authorization = `Bearer ${this.token}`;
    return this.app.inject({ method: method as "GET", url, headers: h, payload: body });
  }
  get(url: string) {
    return this.req("GET", url);
  }
  create(text: string | Buffer, query = "", type = "text/markdown") {
    return this.req("POST", `${A}/items${query}`, text, { "content-type": type });
  }
  save(id: string, text: string | Buffer, revision: string | null, type = "text/markdown") {
    return this.req("PUT", `${A}/items/${id}`, text, revision === null ? { "content-type": type } : { "content-type": type, "if-match": revision });
  }
  append(id: string, text: string, revision?: string) {
    return this.req("POST", `${A}/items/${id}/append`, text, revision ? { "content-type": "text/markdown", "if-match": revision } : { "content-type": "text/markdown" });
  }
}

async function makeToken(c: Client, name = "claude"): Promise<string> {
  const r = await c.post("/api/agents", { name });
  assert.equal(r.statusCode, 201, r.body);
  return r.json().token;
}

/** A server with alice logged in and one agent of hers. The agents' clock moves five seconds a
 *  call, so that a test's many saves are not stopped by the limit of 60 a minute. */
async function setup(): Promise<{ s: TestServer; c: Client; a: AgentClient; dir: string; token: string }> {
  const s = await startServer();
  await s.ctx.addUser("alice", PASSWORD);
  const c = new Client(s.app);
  await c.login("alice");
  const token = await makeToken(c);
  let t = Date.now();
  s.ctx.agents.now = () => (t += 5000);
  return { s, c, a: new AgentClient(s.app, token), dir: path.join(s.root, "users", s.ctx.accounts.byName("alice")!.id), token };
}

const err = (r: LightMyRequestResponse) => r.json().error as { code: string; message: string; hint?: string };
/** A refusal of an agent route: its status, its code, and a hint. */
function refused(r: LightMyRequestResponse, status: number, code: string, hint?: RegExp): void {
  assert.equal(r.statusCode, status, r.body);
  assert.equal(err(r).code, code, r.body);
  assert.equal(typeof err(r).hint, "string", `a hint: ${r.body}`);
  assert.ok(err(r).hint!.length > 10, r.body);
  if (hint) assert.match(err(r).hint!, hint);
}

const rect = (id: string, extra: Record<string, unknown> = {}) => ({ type: "rectangle", id, version: 1, versionNonce: 1, x: 0, y: 0, width: 10, height: 10, isDeleted: false, ...extra });
const imageEl = (id: string, fileId: string, extra: Record<string, unknown> = {}) => ({ type: "image", id, version: 1, fileId, status: "saved", isDeleted: false, ...extra });
const png = (id: string) => ({ id, mimeType: "image/png", dataURL: `data:image/png;base64,${id}AAAA`, created: 1 });
const drawing = (elements: unknown[], files: Record<string, unknown> = {}, nook = { title: "Plan", tags: ["work"], created: "2026-11-12" }) => serializeDrawing({ elements, appState: { viewBackgroundColor: "#ffffff" }, files }, nook);

/** Every file under a folder with the hash of its bytes: what is on disk. */
async function tree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (d: string) => {
    for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) out[path.relative(dir, p)] = sha(await fs.readFile(p));
    }
  };
  await walk(dir);
  return out;
}

// --- tokens (2) ----------------------------------------------------------------------------------

test("tokens: made, listed and revoked; the token is shown once and only its hash is on disk", async () => {
  const { s, c, a, token } = await setup();
  assert.match(token, RE.agentToken);
  const list = (await c.get("/api/agents")).json().agents;
  assert.equal(list.length, 1);
  assert.deepEqual(Object.keys(list[0]).sort(), ["created", "id", "name", "used"]);
  assert.equal(list[0].name, "claude");
  assert.equal(list[0].used, null);
  assert.match(list[0].id, RE.agentId);
  const disk = await fs.readFile(path.join(s.root, "config", "agents.json"), "utf8");
  assert.equal(disk.includes(token), false, "the token itself is never written");
  assert.equal(disk.includes(token.slice(5)), false);
  assert.equal(JSON.parse(disk).agents[0].hash, sha(token));
  assert.equal((await a.get(`${A}/items`)).statusCode, 200);
  assert.equal(typeof (await c.get("/api/agents")).json().agents[0].used, "string", "the first use is recorded");
  assert.equal(s.logs.some((l) => l.includes(token) || l.includes(token.slice(5))), false, "the token is in no log line");
  assert.equal((await c.del(`/api/agents/${list[0].id}`)).statusCode, 200);
  refused(await a.get(`${A}/items`), 401, "no-token", /Account screen/);
  assert.deepEqual((await c.get("/api/agents")).json().agents, []);
  assert.equal((await c.del(`/api/agents/${list[0].id}`)).statusCode, 404, "already gone");
});

test("tokens: the name is trimmed, 1 to 40 characters without control characters, and one of a kind", async () => {
  const { c } = await setup();
  const make = (name: unknown) => c.post("/api/agents", { name });
  assert.equal((await make("  codex on the desk  ")).json().agent.name, "codex on the desk");
  for (const bad of ["", "   ", "x".repeat(41), "a\u0000b", "a\u0085b", "a\u007fb", "a\nb"]) {
    const r = await make(bad);
    assert.equal(r.statusCode, 400, JSON.stringify(bad));
    assert.equal(r.json().error.code, "bad-name");
  }
  assert.equal((await make("x".repeat(40))).statusCode, 201);
  assert.equal((await make("é".repeat(40))).statusCode, 201, "characters, not bytes");
  const dup = await make("CLAUDE");
  assert.equal(dup.statusCode, 409);
  assert.equal(dup.json().error.code, "name-taken");
  assert.equal((await c.post("/api/agents", { name: "y", extra: 1 })).statusCode, 201, "an unknown value is dropped, as on every route");
  assert.equal((await c.post("/api/agents", {})).statusCode, 400, "no name: the schema");
});

test("tokens: at most 20 for a person", async () => {
  const { c } = await setup();
  for (let i = 2; i <= LIMITS.agents; i++) assert.equal((await c.post("/api/agents", { name: `agent ${i}` })).statusCode, 201);
  const r = await c.post("/api/agents", { name: "one too many" });
  assert.equal(r.statusCode, 409);
  assert.equal(r.json().error.code, "limit");
  assert.equal((await c.get("/api/agents")).json().agents.length, LIMITS.agents);
});

test("tokens: one person cannot see or revoke another's, and a token reaches only its own person's items", async () => {
  const { s, c, a } = await setup();
  await s.ctx.addUser("bob", PASSWORD);
  const bob = new Client(s.app);
  bob.ip = "198.51.100.9";
  await bob.login("bob");
  const b = new AgentClient(s.app, await makeToken(bob, "claude"));
  assert.equal((await bob.get("/api/agents")).json().agents.length, 1, "the same name is free for another person");
  const aliceAgent = (await c.get("/api/agents")).json().agents[0].id;
  assert.equal((await bob.del(`/api/agents/${aliceAgent}`)).statusCode, 404);
  assert.equal((await c.get("/api/agents")).json().agents.length, 1);
  const made = (await a.create("alice's\n", "?title=Mine")).json();
  assert.equal((await b.get(`${A}/items`)).json().entries.length, 0);
  for (const r of [await b.get(`${A}/items/${made.id}`), await b.get(`${A}/items/${made.id}/text`), await b.get(`${A}/items/${made.id}/history`), await b.save(made.id, "bob's\n", made.revision), await b.append(made.id, "bob's")]) {
    refused(r, 404, "not-found");
  }
  assert.equal((await a.get(`${A}/items/${made.id}`)).json().text, made.text, "nothing of alice's changed");
});

test("tokens: removing a user, changing a password and resetting one remove that user's tokens", async () => {
  const { s, c, a } = await setup();
  await s.ctx.addUser("bob", PASSWORD);
  const bob = new Client(s.app);
  bob.ip = "198.51.100.9";
  await bob.login("bob");
  const b = new AgentClient(s.app, await makeToken(bob));
  // A password change by the person: her tokens go, bob's stay.
  assert.equal((await c.post("/api/password", { current: PASSWORD, next: "another long password" })).statusCode, 200);
  refused(await a.get(`${A}/items`), 401, "no-token");
  assert.equal((await b.get(`${A}/items`)).statusCode, 200);
  assert.deepEqual((await c.get("/api/agents")).json().agents, []);
  // A reset by the admin.
  const a2 = new AgentClient(s.app, await makeToken(c, "second"));
  assert.equal((await a2.get(`${A}/items`)).statusCode, 200);
  await s.ctx.accounts.resetPassword("alice", "yet another password");
  refused(await a2.get(`${A}/items`), 401, "no-token");
  // Removing a user.
  await s.ctx.removeUser("bob");
  refused(await b.get(`${A}/items`), 401, "no-token");
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(s.root, "config", "agents.json"), "utf8")).agents, []);
});

test("tokens: they are removed before users.json is written, so a failed password reset leaves the old password and no tokens", async () => {
  const { s, a } = await setup();
  const usersFile = path.join(s.root, "config", "users.json");
  // users.json cannot be replaced: a folder is in its place.
  await fs.rm(usersFile);
  await fs.mkdir(usersFile);
  await assert.rejects(s.ctx.accounts.resetPassword("alice", "a brand new password"));
  refused(await a.get(`${A}/items`), 401, "no-token");
  const again = new Client(s.app);
  assert.equal((await again.login("alice", PASSWORD)).statusCode, 200, "the old password still stands");
});

test("tokens: a token whose user is gone from the table is refused, and a restart keeps the tokens", async () => {
  const { s, a, token } = await setup();
  const s2 = await startServer({}, s.root);
  const a2 = new AgentClient(s2.app, token);
  assert.equal((await a2.get(`${A}/items`)).statusCode, 200, "read from agents.json at startup");
  s2.ctx.accounts.users = [];
  refused(await a2.get(`${A}/items`), 401, "no-token");
  void a;
});

test("tokens: the last use is written at most once an hour", async () => {
  const { s, a } = await setup();
  let t = Date.parse("2026-11-12T10:00:00.000Z");
  s.ctx.agents.now = () => t;
  const used = async () => JSON.parse(await fs.readFile(path.join(s.root, "config", "agents.json"), "utf8")).agents[0].used;
  await a.get(`${A}/items`);
  assert.equal(await used(), "2026-11-12T10:00:00.000Z");
  t += 59 * 60 * 1000;
  await a.get(`${A}/items`);
  assert.equal(await used(), "2026-11-12T10:00:00.000Z");
  t += 60 * 1000;
  await a.get(`${A}/items`);
  assert.equal(await used(), "2026-11-12T11:00:00.000Z");
  // A burst an hour later writes the file once, not once a request (review).
  t += 3600 * 1000;
  const file = path.join(s.root, "config", "agents.json");
  let writes = 0;
  const watcher = (await import("node:fs")).watch(path.dirname(file), (_e, name) => {
    if (name === "agents.json") writes++;
  });
  await Promise.all(Array.from({ length: 8 }, () => a.get(`${A}/items`)));
  await new Promise((r) => setTimeout(r, 100));
  watcher.close();
  assert.equal(await used(), "2026-11-12T12:00:00.000Z");
  assert.ok(writes >= 1 && writes <= 4, `${writes} changes of agents.json seen for eight requests at once`);
});

test("3.3 (review): a note that holds only a kept space is not empty, so an agent may not empty it", async () => {
  const { a, c } = await setup();
  const p = await c.create("P");
  const kept = p.text + " \n";
  const saved = await c.save(p.id, kept, p.revision);
  assert.equal(saved.statusCode, 200);
  refused(await a.save(p.id, p.text, saved.json().revision), 422, "empty");
  // And a kept space can be appended: it is content.
  assert.equal((await a.append(p.id, " ")).statusCode, 200);
});

test("tokens: what is not a token is refused without a lookup, and agents.json that cannot be read is an empty table", async () => {
  const { s, a, token } = await setup();
  for (const h of [undefined, "", "Bearer", "Bearer nook_short", `Basic ${token}`, `Bearer ${token.toUpperCase()}`, `Bearer ${token}x`, `Bearer nook_${"a".repeat(40)}`]) {
    const r = await s.app.inject({ method: "GET", url: `${A}/items`, headers: h === undefined ? { host: HOST } : { host: HOST, authorization: h } });
    refused(r, 401, "no-token", new RegExp(`${HOST}${A}`));
  }
  assert.equal((await a.req("GET", `${A}/items`, undefined, { authorization: `bearer   ${token}` })).statusCode, 200, "the scheme's case and spaces do not matter");
  await fs.writeFile(path.join(s.root, "config", "agents.json"), "{ not json");
  const s2 = await startServer({}, s.root);
  refused(await new AgentClient(s2.app, token).get(`${A}/items`), 401, "no-token");
});

// --- the boundary (3) ----------------------------------------------------------------------------

const fill = (url: string) =>
  url
    .replace(":id", "a".repeat(url.startsWith("/api/agents/") ? 16 : 24))
    .replace(":version", "2026-11-10T14-02-11.512Z-k3fa")
    .replace(":file", url.startsWith("/api/fonts/") ? "1.woff2" : "p.png")
    .replace(":name", "S")
    .replace(":slug", "caveat");

/** A request that is valid for a route but for who sends it. */
function validFor(name: string, def: RouteDef): { body: string | undefined; headers: Record<string, string> } {
  const doc = def.body === "markdown" || def.body === "document";
  const headers: Record<string, string> = doc ? { "content-type": "text/markdown", "if-match": "a".repeat(64) } : def.body === "multipart" ? { "content-type": "multipart/form-data; boundary=x" } : {};
  const json: Record<string, unknown> = {
    password: { current: "x", next: "y".repeat(LIMITS.passwordMin) },
    empty: { ids: [] },
    styleSave: { style: { name: "S", bold: true, italic: false, underline: false, strike: false, size: null, font: null, color: null, bg: null } },
    fontAdd: { slug: "caveat" },
    agentMake: { name: "another" },
  };
  if (def.method === "GET" || def.method === "DELETE") return { body: undefined, headers };
  if (doc) return { body: "text", headers };
  if (def.body === "multipart") return { body: "--x--\r\n", headers };
  return { body: JSON.stringify(json[name] ?? {}), headers: { ...headers, "content-type": "application/json" } };
}

test("the boundary: a token is not a session. Every route that takes a session answers 401 to a good token, and nothing on disk changes", async () => {
  const { s, a } = await setup();
  const made = (await a.create("text\n", "?title=Kept")).json();
  const before = await tree(s.root);
  let checked = 0;
  for (const [name, def] of Object.entries(routes) as [string, RouteDef][]) {
    if (def.auth !== "session") continue;
    const { body, headers } = validFor(name, def);
    // A real note's id where the route takes one, so that a request let in would do its work.
    const url = fill(def.url.startsWith("/api/notes/") || def.url.startsWith("/api/trash/") ? def.url.replace(":id", made.id) : def.url);
    const r = await a.req(def.method, url, body, { ...headers, origin: ORIGIN });
    assert.equal(r.statusCode, 401, `${name} ${def.method} ${def.url}: ${r.statusCode} ${r.body}`);
    assert.equal(r.json().error.code, "no-session");
    checked++;
  }
  assert.ok(checked >= 28, `${checked} routes`);
  const after = await tree(s.root);
  // The one file that may change: the token's last use.
  delete before["config/agents.json"];
  delete after["config/agents.json"];
  assert.deepEqual(after, before, "nothing was written, moved or removed");
});

test("the boundary: a session is not a token. Every route that takes a token answers 401 to a good cookie", async () => {
  const { s, c } = await setup();
  const n = await c.create("T");
  let checked = 0;
  for (const [name, def] of Object.entries(routes) as [string, RouteDef][]) {
    if (def.auth !== "token") continue;
    const { body, headers } = validFor(name, def);
    const r = await c.req(def.method, fill(def.url.replace(":id", n.id)), body, headers);
    refused(r, 401, "no-token");
    checked++;
  }
  assert.equal(checked, 8);
  assert.equal((await c.get(`/api/notes/${n.id}`)).json().revision, n.revision);
  void s;
});

test("the boundary: no agent route deletes, and DELETE on every agent address is 404 whatever is sent with it", async () => {
  const { s, c, a } = await setup();
  const made = (await a.create("text\n", "?title=Kept")).json();
  const agentRoutes = (Object.values(routes) as RouteDef[]).filter((d) => d.url.startsWith("/api/agent/"));
  assert.equal(agentRoutes.length, 9);
  assert.deepEqual([...new Set(agentRoutes.map((d) => d.method))].sort(), ["GET", "POST", "PUT"]);
  for (const d of agentRoutes) assert.ok(d.url === A || d.url.startsWith(`${A}/`), d.url);
  const urls = [...new Set(agentRoutes.map((d) => d.url.replace(":id", made.id).replace(":version", "2026-11-10T14-02-11.512Z-k3fa")))];
  for (const url of urls) {
    for (const headers of [{}, { origin: "https://evil.example" }, { origin: ORIGIN }, { "content-type": "text/plain" }, { "content-type": "application/x-unknown", "content-length": "5" }] as Record<string, string>[]) {
      const body = "content-type" in headers ? "hello" : undefined;
      refused(await a.req("DELETE", url, body, headers), 404, "not-found", /no route to delete/);
    }
    // With a session cookie as well, and with no token: still no such route.
    refused(await c.req("DELETE", url), 404, "not-found");
  }
  for (const [method, url] of [["POST", `${A}/nothing`], ["PUT", `${A}/items`], ["POST", `${A}/items/${made.id}/trash`], ["POST", `${A}/items/${made.id}/restore`], ["POST", `${A}/items/${made.id}/photos`], ["PATCH", `${A}/items/${made.id}`], ["POST", "/api/agent/v2/items"], ["GET", "/api/agent/"]] as const) {
    refused(await a.req(method, url, "x", { "content-type": "text/plain" }), 404, "not-found");
  }
  assert.equal((await a.get(`${A}/items/${made.id}`)).json().text, made.text);
  assert.equal((await c.get("/api/trash")).json().entries.length, 0);
  void s;
});

test("the boundary: /api/agents is not under /api/agent/ and keeps the Origin check; an agent route needs no Origin", async () => {
  const { s, c, a } = await setup();
  const noOrigin = await s.app.inject({ method: "POST", url: "/api/agents", headers: { host: HOST, cookie: `notes_session=${c.cookie}`, "content-type": "application/json" }, payload: JSON.stringify({ name: "x" }) });
  assert.equal(noOrigin.statusCode, 403);
  assert.equal(noOrigin.json().error.hint, undefined, "no hint outside the agent addresses");
  assert.equal((await c.req("POST", "/api/agents", { name: "x" }, { origin: "https://evil.example" })).statusCode, 403);
  assert.equal((await c.req("POST", "/api/agents?x=/api/agent/", { name: "x" }, { origin: "https://evil.example" })).statusCode, 403, "the query does not make it an agent address");
  // An agent route: no Origin, a foreign one, the site's own.
  for (const headers of [{}, { origin: "https://evil.example" }, { origin: ORIGIN }] as Record<string, string>[]) {
    assert.equal((await a.req("POST", `${A}/items?title=T`, "x\n", { "content-type": "text/markdown", ...headers })).statusCode, 201);
  }
  // Errors outside the agent addresses carry no hint.
  assert.equal((await c.get("/api/notes/" + "a".repeat(24))).json().error.hint, undefined);
});

test("the boundary: the pages, the bundle's address and the favicon need no session, and neither does the guide", async () => {
  const s = await startServer();
  for (const url of ["/", "/login", "/account", "/n/" + "a".repeat(24), "/favicon.svg"]) {
    const r = await s.app.inject({ method: "GET", url, headers: { host: HOST } });
    assert.equal(r.statusCode, 200, url);
  }
  assert.equal((await s.app.inject({ method: "GET", url: "/assets/none.js", headers: { host: HOST } })).statusCode, 404, "not 401");
  const g = await s.app.inject({ method: "GET", url: A, headers: { host: HOST } });
  assert.equal(g.statusCode, 200);
  assert.match(String(g.headers["content-type"]), /^text\/markdown/);
  assert.equal(g.body.includes("{{SERVER}}"), false);
  assert.ok(g.body.includes(`http://${HOST}${A}/items`));
  const other = await s.app.inject({ method: "GET", url: A, headers: { host: "192.0.2.4:9987" } });
  assert.ok(other.body.includes(`http://192.0.2.4:9987${A}/items`), "the address the request itself used");
});

// --- the interface (5) ---------------------------------------------------------------------------

test("create a note: the server writes the front matter from the title and tags", async () => {
  const { a, dir } = await setup();
  const r = await a.create("- oats\n- lemons\n", "?title=Shopping&tags=food,home");
  assert.equal(r.statusCode, 201, r.body);
  const m = r.json();
  assert.equal(m.text, `---\ntitle: "Shopping"\ntags: [food, home]\ncreated: ${today()}\n---\n\n- oats\n- lemons\n`);
  assert.equal(m.revision, sha(m.text));
  assert.deepEqual(m.entry, { id: m.id, kind: "note", title: "Shopping", tags: ["food", "home"], created: today(), modified: m.entry.modified, size: Buffer.byteLength(m.text), agent: "claude" });
  assert.equal(m.url, `http://${HOST}/n/${m.id}`);
  assert.deepEqual(await ls(path.join(dir, "notes", m.id)), ["note.md", "writers.json"]);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, "notes", m.id, "writers.json"), "utf8")), { current: { agent: "claude", revision: m.revision }, versions: {} }, "the revision of the bytes written, not of the body sent");
});

test("create a note: without a title, with nothing, with its own front matter, and the rules of the title and tags", async () => {
  const { a } = await setup();
  const heading = (await a.create("# Plans\n\ntext\n")).json();
  assert.equal(heading.text, `---\ncreated: ${today()}\n---\n\n# Plans\n\ntext\n`);
  assert.equal(heading.entry.title, "Plans");
  // No body at all, and a body of no bytes: an empty note.
  for (const r of [await a.req("POST", `${A}/items?title=Empty`, undefined, { "content-type": "text/markdown" }), await a.create("", "?title=Empty")]) {
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().text, `---\ntitle: "Empty"\ncreated: ${today()}\n---\n\n`);
  }
  // Its own front matter: stored as sent.
  const own = '---\ntitle: "Mine"\ntags: [a]\ncreated: 2020-01-01\n---\n\ntext\n';
  const sent = (await a.create(own)).json();
  assert.equal(sent.text, own);
  assert.deepEqual([sent.entry.title, sent.entry.tags, sent.entry.created], ["Mine", ["a"], "2020-01-01"]);
  refused(await a.create(own, "?title=Other"), 400, "bad-request", /front matter/);
  refused(await a.create(own, "?tags=b"), 400, "bad-request");
  assert.equal((await a.create(own, "?title=&tags=,")).statusCode, 201, "an empty title and empty tags are none");
  // The title: trimmed; at most 300 characters; no control characters.
  assert.equal((await a.create("x\n", `?title=${encodeURIComponent("  Spaced  ")}`)).json().entry.title, "Spaced");
  assert.equal((await a.create("x\n", `?title=${"t".repeat(300)}`)).statusCode, 201);
  refused(await a.create("x\n", `?title=${"t".repeat(301)}`), 422, "bad-title", /301/);
  refused(await a.create("x\n", `?title=${encodeURIComponent("a\u0007b")}`), 422, "bad-title");
  // Tags: empty parts and repeats dropped; anything else must be a tag.
  assert.deepEqual((await a.create("x\n", "?tags=b,,a,b,%20a%20")).json().entry.tags, ["b", "a"]);
  for (const bad of ["meeting-notes", "2026", "Food", "a b", "x".repeat(31)]) {
    const r = await a.create("x\n", `?tags=ok,${encodeURIComponent(bad)}`);
    refused(r, 422, "bad-tag", new RegExp(bad.slice(0, 5)));
    assert.equal(r.json().tag, bad);
  }
  // The title and tags are checked before the document.
  refused(await a.create("---\ntitle: [\n---\n", "?tags=BAD"), 422, "bad-tag");
  // A quote in a title is kept.
  assert.equal((await a.create("x\n", `?title=${encodeURIComponent('Say "hi" \\ bye')}`)).json().entry.title, 'Say "hi" \\ bye');
});

test("create a note: its line endings, a byte order mark, and each refusal of the document", async () => {
  const { a } = await setup();
  assert.equal((await a.create("one\r\ntwo\r\n", "?title=T")).json().text, `---\r\ntitle: "T"\r\ncreated: ${today()}\r\n---\r\n\r\none\r\ntwo\r\n`);
  assert.equal((await a.create("﻿body\n", "?title=T")).json().text, `---\ntitle: "T"\ncreated: ${today()}\n---\n\nbody\n`);
  refused(await a.create("---\ntitle: [unclosed\n---\n\ntext\n"), 422, "broken-front-matter", /YAML/);
  refused(await a.create(Buffer.from([0x66, 0xff, 0x66])), 422, "not-utf8");
  const big = await a.create("x".repeat(LIMITS.noteBytes + 1));
  refused(big, 413, "too-large", new RegExp(String(LIMITS.noteBytes)));
  // The limit is checked again on the bytes to be written: the body fits, the front matter does not.
  refused(await a.create("x".repeat(LIMITS.noteBytes - 5), "?title=T"), 413, "too-large");
  assert.equal((await a.create("x".repeat(LIMITS.noteBytes - 200), "?title=T")).statusCode, 201, "over Fastify's 64 KB, within a note's limit");
  // No Content-Type: the most common mistake.
  refused(await a.req("POST", `${A}/items`, "text"), 415, "unsupported-type", /Content-Type: text\/markdown/);
  refused(await a.req("POST", `${A}/items`), 415, "unsupported-type");
  refused(await a.req("POST", `${A}/items`, "{}", { "content-type": "application/json" }), 415, "unsupported-type");
  // There is no `from`: an address value the route does not have is dropped, as on every route.
  const from = (await a.create("![](note.assets/p.png)\n", "?title=T")).json();
  const copy = await a.req("POST", `${A}/items?from=${from.id}`, "x", { "content-type": "text/markdown" });
  assert.equal(copy.statusCode, 201);
  assert.equal(copy.json().photosMissing, undefined);
});

test("create a drawing: nook is added when it is missing, and a drawing with its own is stored as sent", async () => {
  const { a, c } = await setup();
  const bare = JSON.stringify({ type: "excalidraw", version: 2, elements: [rect("a"), rect("gone", { isDeleted: true })], appState: { viewBackgroundColor: "#fff", zoom: { value: 2 } }, files: { unused: png("unused") }, extra: 1 });
  const r = await a.create(bare, "?tags=work", DRAWING_TYPE);
  assert.equal(r.statusCode, 201, r.body);
  const m = r.json();
  const doc = JSON.parse(m.text);
  assert.deepEqual(Object.keys(doc), ["type", "version", "elements", "appState", "files", "extra", "nook"]);
  assert.deepEqual(doc.nook, { title: "Untitled 1", tags: ["work"], created: today() });
  assert.equal(doc.elements.length, 2, "serializeDrawing is not used: a deleted element stays");
  assert.deepEqual(doc.files, { unused: png("unused") });
  assert.deepEqual(doc.appState, { viewBackgroundColor: "#fff", zoom: { value: 2 } });
  assert.equal(m.text, JSON.stringify(doc, null, 2) + "\n");
  assert.deepEqual([m.entry.kind, m.entry.title, m.entry.tags, m.entry.agent], ["drawing", "Untitled 1", ["work"], "claude"]);
  assert.equal(m.url, `http://${HOST}/d/${m.id}`);
  assert.equal((await a.create(bare, "?title=Named", DRAWING_TYPE)).json().entry.title, "Named");
  assert.equal((await a.create(bare, "", DRAWING_TYPE)).json().entry.title, "Untitled 2", "Untitled N counts every item");
  // With its own nook: stored as sent, byte for byte.
  const own = drawing([rect("a")]);
  const sent = (await a.create(own, "", DRAWING_TYPE)).json();
  assert.equal(sent.text, own);
  assert.equal(sent.entry.title, "Plan");
  refused(await a.create(own, "?title=Other", DRAWING_TYPE), 400, "bad-request", /nook/);
  const odd = JSON.stringify({ type: "excalidraw", elements: [], nook: 5 });
  assert.equal((await a.create(odd, "", DRAWING_TYPE)).json().text, odd, "a nook of any shape is its own");
  // An empty drawing may be created; the refusals of 3.3 are of a save.
  assert.equal((await a.create(JSON.stringify({ type: "excalidraw", elements: [] }), "", DRAWING_TYPE)).statusCode, 201);
  refused(await a.create("{ not json", "", DRAWING_TYPE), 422, "not-json");
  refused(await a.create("[]", "", DRAWING_TYPE), 422, "not-json");
  refused(await a.create('{"type":"other","elements":[]}', "", DRAWING_TYPE), 422, "not-excalidraw", /example/);
  refused(await a.req("POST", `${A}/items`, undefined, { "content-type": DRAWING_TYPE }), 422, "not-json");
  // A person opens what the agent made.
  assert.equal((await c.get(`/api/notes/${m.id}`)).json().text, m.text);
});

test("list, read, the raw text with its ETag, and history", async () => {
  const { a, c } = await setup();
  const n = (await a.create("first\n", "?title=Alpha&tags=x")).json();
  const d = (await a.create(drawing([rect("a")]), "", DRAWING_TYPE)).json();
  const person = await c.create("By hand");
  const list = (await a.get(`${A}/items`)).json();
  assert.deepEqual(list.entries.map((e: { title: string; agent: string | null }) => [e.title, e.agent]).sort(), [["Alpha", "claude"], ["By hand", null], ["Plan", "claude"]]);
  assert.deepEqual(list.tags, [{ tag: "work", count: 1 }, { tag: "x", count: 1 }]);
  assert.deepEqual((await a.get(`${A}/items?q=first`)).json().entries.map((e: { id: string }) => e.id), [n.id]);
  assert.deepEqual((await a.get(`${A}/items?tag=work`)).json().entries.map((e: { id: string }) => e.id), [d.id]);
  refused(await a.get(`${A}/items?q=${"x".repeat(501)}`), 400, "bad-request", /querystring\/q/);
  const read = (await a.get(`${A}/items/${n.id}`)).json();
  assert.deepEqual(read, { text: n.text, revision: n.revision, entry: n.entry, url: n.url });
  assert.equal((await a.get(`${A}/items/${person.id}`)).json().entry.agent, null, "a person's note can be read");
  const raw = await a.get(`${A}/items/${n.id}/text`);
  assert.equal(raw.statusCode, 200);
  assert.equal(raw.body, n.text);
  assert.equal(raw.headers.etag, `"${n.revision}"`);
  assert.match(String(raw.headers["content-type"]), /^text\/markdown/);
  const rawD = await a.get(`${A}/items/${d.id}/text`);
  assert.equal(rawD.body, d.text);
  assert.match(String(rawD.headers["content-type"]), new RegExp("^" + DRAWING_TYPE.replace("+", "\\+")));
  // The ETag as it is given is taken back by a save.
  assert.equal((await a.save(n.id, n.text + "more\n", String(raw.headers.etag))).statusCode, 200);
  const versions = (await a.get(`${A}/items/${n.id}/history`)).json().versions;
  assert.equal(versions.length, 1);
  assert.deepEqual(Object.keys(versions[0]).sort(), ["agent", "size", "time", "version"]);
  assert.equal(versions[0].agent, "claude");
  assert.deepEqual((await a.get(`${A}/items/${n.id}/history/${versions[0].version}`)).json(), { text: n.text });
  refused(await a.get(`${A}/items/${n.id}/history/2026-11-10T14-02-11.512Z-k3fa`), 404, "not-found");
  refused(await a.get(`${A}/items/${"b".repeat(24)}`), 404, "not-found");
  refused(await a.get(`${A}/items/short`), 400, "bad-request", /params\/id/);
});

test("save: the revision, each refusal in its order, and the conflict with what is there now", async () => {
  const { a, c, dir } = await setup();
  const n = (await a.create("one\n", "?title=T")).json();
  refused(await a.save(n.id, "x\n", null), 428, "no-revision", /If-Match/);
  refused(await a.save(n.id, "x\n", "not-a-revision"), 400, "bad-request", /64 hex/);
  refused(await a.save("b".repeat(24), "x\n", null), 428, "no-revision", undefined);
  refused(await a.save("b".repeat(24), "x\n", n.revision), 404, "not-found");
  refused(await a.save(n.id, drawing([rect("a")]), n.revision, DRAWING_TYPE), 415, "unsupported-type");
  refused(await a.save(n.id, "x".repeat(LIMITS.noteBytes + 1), "f".repeat(64)), 413, "too-large", new RegExp(String(LIMITS.noteBytes + 1)));
  const stale = await a.save(n.id, "---\ntitle: [\n---\n", "f".repeat(64));
  refused(stale, 409, "changed", /new revision/);
  assert.deepEqual(stale.json().current, { text: n.text, revision: n.revision, entry: n.entry }, "the conflict comes before the checks of the new bytes");
  refused(await a.save(n.id, "---\ntitle: [\n---\n", n.revision), 422, "broken-front-matter");
  refused(await a.save(n.id, Buffer.from([0xff]), n.revision), 422, "not-utf8");
  refused(await a.req("PUT", `${A}/items/${n.id}`, "x", { "if-match": n.revision }), 415, "unsupported-type");
  const next = n.text + "two\n";
  const ok = await a.save(n.id, next, `"${n.revision}"`);
  assert.equal(ok.statusCode, 200, ok.body);
  assert.deepEqual(ok.json(), { revision: sha(next), entry: { ...n.entry, modified: ok.json().entry.modified, size: Buffer.byteLength(next) }, url: n.url });
  // The same bytes again: nothing is written.
  const before = await tree(path.join(dir, "notes", n.id));
  assert.equal((await a.save(n.id, next, sha(next))).json().revision, sha(next));
  assert.deepEqual(await tree(path.join(dir, "notes", n.id)), before);
  // In the trash: only a person can bring it back.
  await c.del(`/api/notes/${n.id}`);
  for (const r of [await a.get(`${A}/items/${n.id}`), await a.get(`${A}/items/${n.id}/text`), await a.get(`${A}/items/${n.id}/history`), await a.save(n.id, "x\n", sha(next)), await a.append(n.id, "x")]) refused(r, 410, "trashed", /Only a person/);
  assert.equal((await a.get(`${A}/items`)).json().entries.length, 0);
});

test("save: a conflict over a file that is not UTF-8 has no current, and its hint says a person must mend it", async () => {
  const { a, dir } = await setup();
  const n = (await a.create("one\n", "?title=T")).json();
  await fs.writeFile(path.join(dir, "notes", n.id, "note.md"), Buffer.from([0x66, 0xff, 0x66]));
  const r = await a.save(n.id, "two\n", n.revision);
  refused(r, 409, "changed", /person must mend/);
  assert.equal(r.json().current, undefined);
  refused(await a.get(`${A}/items/${n.id}`), 422, "not-utf8");
  refused(await a.get(`${A}/items/${n.id}/text`), 422, "not-utf8");
  refused(await a.append(n.id, "x"), 422, "not-utf8", /person must mend/);
});

test("3.3: an agent's save may not empty a note or a drawing, or drop an image; a person's may", async () => {
  const { a, c } = await setup();
  const n = (await a.create("text\n", "?title=T")).json();
  const head = n.text.slice(0, n.text.indexOf("text"));
  for (const empty of ["", head, head + "  \n\n\t", "\n \n"]) refused(await a.save(n.id, empty, n.revision), 422, "empty", /whole/);
  assert.equal((await a.get(`${A}/items/${n.id}`)).json().text, n.text);
  // A note that is already empty may be saved empty: nothing is lost.
  const blank = (await a.create("", "?title=Blank")).json();
  assert.equal((await a.save(blank.id, blank.text + "\n", blank.revision)).statusCode, 200);
  // A person empties what they like.
  assert.equal((await c.save(n.id, head, n.revision)).statusCode, 200);

  // A drawing: elements marked deleted do not count.
  const files = { f1: png("f1"), f2: png("f2") };
  const d = (await a.create(drawing([rect("a"), imageEl("i1", "f1"), imageEl("i2", "f2")], files), "", DRAWING_TYPE)).json();
  const raw = (elements: unknown[], f: Record<string, unknown> | undefined) => JSON.stringify({ type: "excalidraw", version: 2, elements, ...(f ? { files: f } : {}), nook: { title: "Plan", tags: [], created: "2026-11-12" } });
  refused(await a.save(d.id, raw([], files), d.revision, DRAWING_TYPE), 422, "empty");
  refused(await a.save(d.id, raw([rect("a", { isDeleted: true }), imageEl("i1", "f1", { isDeleted: true })], files), d.revision, DRAWING_TYPE), 422, "empty");
  // An image an element still uses must stay in files.
  const dropped = await a.save(d.id, raw([rect("a"), imageEl("i1", "f1"), imageEl("i2", "f2")], { f1: png("f1") }), d.revision, DRAWING_TYPE);
  refused(dropped, 422, "missing-image", /"f2"/);
  assert.equal(dropped.json().file, "f2");
  refused(await a.save(d.id, raw([rect("a"), imageEl("i1", "f1")], undefined), d.revision, DRAWING_TYPE), 422, "missing-image", /"f1"/);
  // An image whose element is deleted or gone may go with it.
  const fewer = raw([rect("a"), imageEl("i1", "f1"), imageEl("i2", "f2", { isDeleted: true })], { f1: png("f1") });
  const ok = await a.save(d.id, fewer, d.revision, DRAWING_TYPE);
  assert.equal(ok.statusCode, 200, ok.body);
  // An element may name an image the drawing never had: this save drops nothing.
  const odd = raw([rect("a"), imageEl("i1", "f1"), imageEl("i9", "never")], { f1: png("f1") });
  assert.equal((await a.save(d.id, odd, ok.json().revision, DRAWING_TYPE)).statusCode, 200);
  // A person's save has no such checks.
  const p = await c.req("PUT", `/api/notes/${d.id}`, Buffer.from(raw([], {})), { "content-type": DRAWING_TYPE, "if-match": sha(odd) });
  assert.equal(p.statusCode, 200, p.body);
});

test("append: one empty line before the added text, the note's line endings, and no revision needed", async () => {
  const { a, c } = await setup();
  const n = (await a.create("one\n", "?title=T")).json();
  const r = await a.append(n.id, "two\n");
  assert.equal(r.statusCode, 200, r.body);
  const want = n.text + "\ntwo\n";
  assert.deepEqual(r.json(), { revision: sha(want), entry: { ...n.entry, modified: r.json().entry.modified, size: Buffer.byteLength(want) }, url: n.url });
  assert.equal((await a.get(`${A}/items/${n.id}`)).json().text, want);
  // With a revision: a stale one is a conflict, the right one works.
  const stale = await a.append(n.id, "three", n.revision);
  refused(stale, 409, "changed");
  assert.equal(stale.json().current.text, want);
  assert.equal((await a.append(n.id, "three", `"${sha(want)}"`)).statusCode, 200);
  assert.equal((await a.get(`${A}/items/${n.id}`)).json().text, want + "\nthree\n");
  refused(await a.append(n.id, "x", "nope"), 400, "bad-request");
  // A note that is only front matter keeps its front matter.
  const blank = (await a.create("", "?title=Log&tags=x")).json();
  const first = (await a.append(blank.id, "- first")).json();
  const got = (await a.get(`${A}/items/${blank.id}`)).json();
  assert.equal(got.text, `---\ntitle: "Log"\ntags: [x]\ncreated: ${today()}\n---\n- first\n`);
  assert.deepEqual([first.entry.title, first.entry.tags, first.entry.created], ["Log", ["x"], today()]);
  await a.append(blank.id, "- second");
  assert.equal((await a.get(`${A}/items/${blank.id}`)).json().text, `---\ntitle: "Log"\ntags: [x]\ncreated: ${today()}\n---\n- first\n\n- second\n`);
  // A person's note with CRLF and trailing empty lines.
  const p = await c.create("P");
  const crlf = '---\r\ntitle: "P"\r\n---\r\n\r\nline\r\n\r\n\r\n';
  const saved = await c.save(p.id, crlf, p.revision);
  assert.equal(saved.statusCode, 200);
  const ap = await a.append(p.id, "a\nb\n");
  assert.equal(ap.json().entry.agent, "claude");
  assert.equal((await a.get(`${A}/items/${p.id}`)).json().text, '---\r\ntitle: "P"\r\n---\r\n\r\nline\r\n\r\na\r\nb\r\n');
});

test("append: what is refused", async () => {
  const { a, c, dir } = await setup();
  const n = (await a.create("one\n", "?title=T")).json();
  for (const empty of ["", "  \n\t\r\n"]) refused(await a.append(n.id, empty), 422, "empty", /text to add/);
  refused(await a.req("POST", `${A}/items/${n.id}/append`, undefined, { "content-type": "text/markdown" }), 422, "empty");
  refused(await a.req("POST", `${A}/items/${n.id}/append`, "x"), 415, "unsupported-type");
  refused(await a.req("POST", `${A}/items/${n.id}/append`, "{}", { "content-type": DRAWING_TYPE }), 415, "unsupported-type");
  refused(await a.append("b".repeat(24), "x"), 404, "not-found");
  refused(await a.req("POST", `${A}/items/${n.id}/append`, Buffer.from([0xff]), { "content-type": "text/markdown" }), 422, "not-utf8");
  const d = (await a.create(drawing([rect("a")]), "", DRAWING_TYPE)).json();
  refused(await a.append(d.id, "x"), 415, "unsupported-type", /PUT/);
  // The limit is on the whole result.
  const big = (await a.create("x".repeat(LIMITS.noteBytes - 300), "?title=Big")).json();
  refused(await a.append(big.id, "y".repeat(400)), 413, "too-large");
  assert.equal((await a.append(big.id, "y".repeat(100))).statusCode, 200);
  // Past the route's own limit (review): the size sent and the limit are in the hint.
  const routeLimit = LIMITS.noteBytes + 64 * 1024;
  const past = await a.append(big.id, "y".repeat(routeLimit + 1));
  refused(past, 413, "too-large", new RegExp(`${routeLimit + 1} bytes.*at most ${routeLimit}`));
  // A note whose front matter is already broken (a hand edit): a person must mend it.
  const p = await c.create("P");
  await fs.writeFile(path.join(dir, "notes", p.id, "note.md"), "---\ntitle: [unclosed\n---\n\ntext\n");
  refused(await a.append(p.id, "x"), 422, "broken-front-matter", /person must mend/);
  assert.equal(await fs.readFile(path.join(dir, "notes", p.id, "note.md"), "utf8"), "---\ntitle: [unclosed\n---\n\ntext\n");
});

// --- the limits (3.3) ----------------------------------------------------------------------------

test("3.3: at most 60 changing requests a minute for a person, across tokens; a refused one counts; reading is free", async () => {
  const { s, c, a } = await setup();
  let t = Date.parse("2026-11-12T10:00:00.000Z");
  s.ctx.agents.now = () => t;
  const second = new AgentClient(s.app, await makeToken(c, "second"));
  const n = (await a.create("x\n", "?title=T")).json();
  // 59 more, some of them refused, from two tokens.
  for (let i = 0; i < 59; i++) {
    const r = await (i % 2 ? a : second).save(n.id, "x\n", "f".repeat(64));
    assert.equal(r.statusCode, 409, `${i}: ${r.body}`);
  }
  const over = await second.append(n.id, "y");
  refused(over, 429, "busy", /Wait \d+ seconds/);
  assert.equal((await a.get(`${A}/items/${n.id}`)).json().text, n.text, "the refused append wrote nothing");
  for (let i = 0; i < 80; i++) assert.equal((await a.get(`${A}/items`)).statusCode, 200);
  // Another person has their own count.
  await s.ctx.addUser("bob", PASSWORD);
  const bob = new Client(s.app);
  bob.ip = "198.51.100.9";
  await bob.login("bob");
  assert.equal((await new AgentClient(s.app, await makeToken(bob)).create("x\n")).statusCode, 201);
  // A minute after the first of them.
  t += 60_001;
  assert.equal((await a.append(n.id, "y")).statusCode, 200);
});

test("3.3 (review): an agent that waits as the 429 says is let in, and one that retries sooner is not", async () => {
  const { s, a } = await setup();
  let t = Date.parse("2026-11-12T10:00:00.000Z");
  s.ctx.agents.now = () => t;
  const n = (await a.create("x\n", "?title=T")).json();
  // One change a second: 60 of them with the create, the last at 59 seconds.
  for (let i = 1; i < 60; i++) {
    t += 1000;
    assert.equal((await a.append(n.id, `line ${i}`)).statusCode, 200, String(i));
  }
  t += 500;
  const over = await a.append(n.id, "too many");
  refused(over, 429, "busy");
  const wait = Number(/Wait (\d+) seconds/.exec(err(over).hint!)![1]);
  // The refused request counts, so the wait is until two have left the minute, not one.
  assert.equal(wait, 2);
  const before = t;
  t = before + (wait - 1) * 1000;
  // (Asking a second early is itself counted, and so pushes the moment on.)
  const early = await a.append(n.id, "too soon");
  refused(early, 429, "busy");
  t += Number(/Wait (\d+) seconds/.exec(err(early).hint!)![1]) * 1000;
  assert.equal((await a.append(n.id, "in time")).statusCode, 200, "let in at the moment the hint named");
});

test("3.3 (review): the bytes of a real request are counted, and past the day's total it is refused", async () => {
  const { s, a } = await setup();
  const user = s.ctx.accounts.byName("alice")!.id;
  // All but 100 bytes of the day are used.
  s.ctx.agents.count(user, LIMITS.agentBytesPerDay - 100);
  assert.equal((await a.create("x".repeat(60), "?title=Fits")).statusCode, 201);
  const over = await a.create("y".repeat(41), "?title=Over");
  refused(over, 429, "busy", /41 bytes .*try again in about 24 hours/);
  assert.deepEqual([over.json().size, over.json().limit], [41, LIMITS.agentBytesPerDay]);
  assert.equal((await a.create("z".repeat(40), "?title=Just")).statusCode, 201, "exactly what is left");
  assert.equal((await a.get(`${A}/items`)).json().entries.length, 2);
  // A request larger than the whole allowance is told so.
  const agents = new Agents({} as never, {} as never, { info: () => {}, error: () => {} }, () => undefined);
  assert.throws(() => agents.count("u", LIMITS.agentBytesPerDay + 1), (e: { hint: string }) => /larger than a whole day/.test(e.hint));
});

test("3.3: at most 300 MB of bodies in 24 hours for a person", () => {
  const log = { info: () => {}, error: () => {} };
  const agents = new Agents({} as never, {} as never, log, () => undefined);
  let t = Date.parse("2026-11-12T10:00:00.000Z");
  agents.now = () => (t += 2000);
  agents.count("u1", 200 * MB);
  agents.count("u1", 100 * MB);
  assert.throws(
    () => agents.count("u1", 1),
    (e: { status: number; code: string; hint: string }) => e.status === 429 && e.code === "busy" && /hours/.test(e.hint),
  );
  agents.count("u1", 0);
  agents.count("u2", 300 * MB);
  t += 24 * 3600 * 1000;
  agents.count("u1", 300 * MB);
  assert.equal(LIMITS.agentBytesPerDay, 300 * MB);
});

// --- who wrote what (4) --------------------------------------------------------------------------

const names = async (dir: string) => ls(dir);
const writersOf = async (dir: string, id: string) => JSON.parse(await fs.readFile(path.join(dir, "notes", id, "writers.json"), "utf8"));

test("writers: the mark in entries and history through each mix of a person's and an agent's saves", async () => {
  const { a, c, dir } = await setup();
  const p = await c.create("P");
  const folder = path.join(dir, "notes", p.id);
  assert.deepEqual(await names(folder), ["note.md"], "a person's item has no writers file");
  // An agent saves over a person's text.
  const t1 = p.text + "agent one\n";
  const s1 = (await a.save(p.id, t1, p.revision)).json();
  assert.equal(s1.entry.agent, "claude");
  assert.deepEqual(await names(folder), ["history", "note.md", "writers.json"]);
  assert.deepEqual(await writersOf(dir, p.id), { current: { agent: "claude", revision: sha(t1) }, versions: {} });
  let h = (await c.get(`/api/notes/${p.id}/history`)).json().versions;
  assert.deepEqual(h.map((v: { agent: string | null }) => v.agent), [null], "the text it replaced was a person's");
  assert.equal((await c.get(`/api/notes/${p.id}`)).json().entry.agent, "claude", "the browser's routes say so too");
  assert.equal((await c.get("/api/notes")).json().entries[0].agent, "claude");
  // The agent saves again: its own text goes to agent-history, with its name.
  const t2 = t1 + "agent two\n";
  const s2 = (await a.save(p.id, t2, s1.revision)).json();
  assert.deepEqual(await names(folder), ["agent-history", "history", "note.md", "writers.json"]);
  h = (await a.get(`${A}/items/${p.id}/history`)).json().versions;
  assert.deepEqual(h.map((v: { agent: string | null }) => v.agent), ["claude", null]);
  assert.equal((await c.get(`/api/notes/${p.id}/history/${h[0].version}`)).json().text, t1, "a version is read from whichever folder holds it");
  assert.equal((await c.get(`/api/notes/${p.id}/history/${h[1].version}`)).json().text, p.text);
  // A person saves the same bytes: nothing is written, the mark stays.
  assert.equal((await c.save(p.id, t2, s2.revision)).json().entry.agent, "claude");
  // A person saves a change: the mark goes, and the agent's text is an agent's version.
  const t3 = t2 + "person\n";
  const s3 = (await c.save(p.id, t3, s2.revision)).json();
  assert.equal(s3.entry.agent, null);
  h = (await c.get(`/api/notes/${p.id}/history`)).json().versions;
  assert.deepEqual(h.map((v: { agent: string | null }) => v.agent), ["claude", "claude", null]);
  assert.equal((await writersOf(dir, p.id)).current, null);
  assert.equal(Object.keys((await writersOf(dir, p.id)).versions).length, 2);
  // A person saves again: a person's version, in history/.
  await c.save(p.id, t3 + "more\n", s3.revision);
  assert.equal((await names(path.join(folder, "history"))).length, 2);
  assert.equal((await names(path.join(folder, "agent-history"))).length, 2);
  // A second agent has its own name; revoking the first changes nothing recorded.
  const second = new AgentClient(a.app, await makeToken(c, "codex"));
  const s5 = (await second.append(p.id, "by codex")).json();
  assert.equal(s5.entry.agent, "codex");
  const first = (await c.get("/api/agents")).json().agents.find((x: { name: string }) => x.name === "claude");
  await c.del(`/api/agents/${first.id}`);
  h = (await c.get(`/api/notes/${p.id}/history`)).json().versions;
  assert.deepEqual(h.map((v: { agent: string | null }) => v.agent), [null, null, "claude", "claude", null]);
});

test("writers: an agent's request never removes a version a person wrote. A full history survives 51 agent saves, file for file", async () => {
  const { a, c, dir } = await setup();
  const p = await c.create("P");
  const folder = path.join(dir, "notes", p.id);
  let rev = p.revision;
  let text = p.text;
  // 51 saves by the person: history/ holds the newest 50, its limit.
  for (let i = 1; i <= LIMITS.history + 1; i++) {
    text = `${p.text}person ${i}\n`;
    rev = (await c.save(p.id, text, rev)).json().revision;
  }
  const before = await tree(path.join(folder, "history"));
  assert.equal(Object.keys(before).length, LIMITS.history);
  const personsLast = text;
  // 51 saves by an agent.
  for (let i = 1; i <= 51; i++) {
    text = `${p.text}agent ${i}\n`;
    const r = await a.save(p.id, text, rev);
    assert.equal(r.statusCode, 200, r.body);
    rev = r.json().revision;
  }
  const after = await tree(path.join(folder, "history"));
  for (const [name, hash] of Object.entries(before)) assert.equal(after[name], hash, `${name} is still there with the bytes it had`);
  assert.equal(Object.keys(after).length, LIMITS.history + 1, "and the text the agent first replaced is a 51st");
  const added = Object.keys(after).find((n) => !(n in before))!;
  assert.equal(await fs.readFile(path.join(folder, "history", added), "utf8"), personsLast);
  // The agents' versions: the newest 10, each with its name; names without files are gone.
  const agentFiles = await names(path.join(folder, "agent-history"));
  assert.equal(agentFiles.length, LIMITS.agentHistory);
  const w = await writersOf(dir, p.id);
  assert.deepEqual(Object.keys(w.versions).sort(), agentFiles.map((n) => n.replace(/\.md$/, "")));
  assert.equal(await fs.readFile(path.join(folder, "agent-history", agentFiles[agentFiles.length - 1]), "utf8"), `${p.text}agent 50\n`);
  const listed = (await a.get(`${A}/items/${p.id}/history`)).json().versions;
  assert.equal(listed.length, LIMITS.history + 1 + LIMITS.agentHistory);
  assert.equal(listed.filter((v: { agent: string | null }) => v.agent === "claude").length, LIMITS.agentHistory);
  // The person's next save removes the person's oldest beyond 50, as their own save always has.
  await c.save(p.id, `${p.text}person again\n`, rev);
  const then = await names(path.join(folder, "history"));
  assert.equal(then.length, LIMITS.history);
  assert.equal(then.includes(Object.keys(before).sort()[0]), false, "the oldest went");
  assert.equal((await names(path.join(folder, "agent-history"))).length, LIMITS.agentHistory, "the agent's last text came in and its oldest went");
});

test("writers: the same for a drawing, with 20 of a person's and 5 of agents'", async () => {
  const { a, c, dir } = await setup();
  const made = (await c.post("/api/notes", { kind: "drawing", title: "D" })).json();
  const folder = path.join(dir, "notes", made.id);
  const put = (who: Client | AgentClient, text: string, rev: string) =>
    who instanceof Client ? who.req("PUT", `/api/notes/${made.id}`, Buffer.from(text), { "content-type": DRAWING_TYPE, "if-match": rev }) : who.save(made.id, text, rev, DRAWING_TYPE);
  let rev = made.revision;
  for (let i = 1; i <= LIMITS.drawingHistory + 1; i++) rev = (await put(c, drawing([rect(`p${i}`)]), rev)).json().revision;
  const before = await tree(path.join(folder, "history"));
  assert.equal(Object.keys(before).length, LIMITS.drawingHistory);
  for (let i = 1; i <= 12; i++) {
    const r = await put(a, drawing([rect(`a${i}`)]), rev);
    assert.equal(r.statusCode, 200, r.body);
    rev = r.json().revision;
  }
  const after = await tree(path.join(folder, "history"));
  for (const [name, hash] of Object.entries(before)) assert.equal(after[name], hash, name);
  assert.equal(Object.keys(after).length, LIMITS.drawingHistory + 1);
  assert.equal((await names(path.join(folder, "agent-history"))).length, LIMITS.agentDrawingHistory);
  assert.ok((await names(path.join(folder, "agent-history"))).every((n) => n.endsWith(".excalidraw")));
});

test("writers: a hand edit after an agent's save is a person's, and so is everything when writers.json is missing or broken", async () => {
  const { a, c, dir } = await setup();
  const n = (await a.create("agent\n", "?title=T")).json();
  const folder = path.join(dir, "notes", n.id);
  const file = path.join(folder, "note.md");
  // A hand edit: the revision no longer matches, so the file counts as a person's.
  const edited = n.text + "by hand\n";
  await fs.writeFile(file, edited);
  await fs.utimes(file, new Date(), new Date(Date.now() + 5000));
  assert.equal((await a.get(`${A}/items/${n.id}`)).json().entry.agent, null);
  // An agent saves over it: the hand edit goes to history/, never to agent-history/.
  const s1 = (await a.save(n.id, edited + "agent again\n", sha(edited))).json();
  assert.equal(s1.entry.agent, "claude");
  assert.deepEqual(await names(folder), ["history", "note.md", "writers.json"]);
  assert.equal(await fs.readFile(path.join(folder, "history", (await names(path.join(folder, "history")))[0]), "utf8"), edited);
  // Put back by hand to the agent's exact bytes: those are the bytes the agent wrote (4.2).
  await a.save(n.id, edited + "agent 2\n", s1.revision);
  assert.equal((await names(path.join(folder, "agent-history"))).length, 1);
  for (const broken of ["{ not json", "[]", '{"current":{"agent":"claude","revision":"short"},"versions":{}}', '{"current":null,"versions":{"x":5}}', '{"current":{"agent":7,"revision":"' + "a".repeat(64) + '"},"versions":{}}', '{"versions":{}}']) {
    await fs.writeFile(path.join(folder, "writers.json"), broken);
    await fs.utimes(file, new Date(), new Date(Date.now() + 10_000 + Math.random() * 1000));
    const read = (await a.get(`${A}/items/${n.id}`)).json();
    assert.equal(read.entry.agent, null, `${broken}: the main file is a person's`);
    const h = (await a.get(`${A}/items/${n.id}/history`)).json().versions;
    assert.deepEqual(h.map((v: { agent: string | null }) => v.agent), ["an agent", null], `${broken}: an agent's version without a name`);
  }
  // An agent's save with a broken file: the old text is a person's, and the file is made valid.
  const cur = (await a.get(`${A}/items/${n.id}`)).json();
  const saved = (await a.save(n.id, cur.text + "after broken\n", cur.revision)).json();
  assert.equal(saved.entry.agent, "claude");
  assert.equal((await names(path.join(folder, "history"))).length, 2, "it went to history/");
  assert.deepEqual(await writersOf(dir, n.id), { current: { agent: "claude", revision: saved.revision }, versions: {} });
  // Missing altogether.
  await fs.rm(path.join(folder, "writers.json"));
  await fs.utimes(file, new Date(), new Date(Date.now() + 30_000));
  assert.equal((await a.get(`${A}/items/${n.id}`)).json().entry.agent, null);
  // A person's save with no writers file and nothing to record writes none.
  const now = (await c.get(`/api/notes/${n.id}`)).json();
  await c.save(n.id, now.text + "person\n", now.revision);
  assert.equal((await names(folder)).includes("writers.json"), false);
});

/** Runs a request that stops (throws) at a named step of a save, leaving the disk as a crash
 *  there would. */
async function stoppedAt<T>(stepName: string, fn: () => Promise<T>): Promise<T> {
  let hit = false;
  faults.before = (name) => {
    if (name === stepName) {
      hit = true;
      throw new Error(`stopped at ${stepName}`);
    }
  };
  try {
    const r = await fn();
    assert.equal(hit, true, `the request did not reach ${stepName}`);
    return r;
  } finally {
    faults.before = undefined;
  }
}

test("writers: stopped after each step of a save, a person's text is never taken for an agent's", async () => {
  const steps = ["save:history", "save:writers", "save:replaced", "save:pruned"] as const;
  // An agent saving over a person's text.
  for (const stepName of steps) {
    const { a, c, dir } = await setup();
    const p = await c.create("P");
    const folder = path.join(dir, "notes", p.id);
    const agentText = p.text + "agent\n";
    const r = await stoppedAt(stepName, () => a.save(p.id, agentText, p.revision));
    refused(r, 500, "server", /may or may not/);
    const now = (await c.get(`/api/notes/${p.id}`)).json();
    const replaced = stepName === "save:replaced" || stepName === "save:pruned";
    assert.equal(now.text, replaced ? agentText : p.text, stepName);
    assert.equal(now.entry.agent, null, `${stepName}: no revision is recorded before its bytes are the main file`);
    // Whatever is there now is filed as a person's by the next save, in history/.
    const next = await a.save(p.id, now.text + "next\n", now.revision);
    assert.equal(next.statusCode, 200, next.body);
    assert.equal(next.json().entry.agent, "claude");
    assert.equal((await names(folder)).includes("agent-history"), false, stepName);
    const kept = await Promise.all((await names(path.join(folder, "history"))).map((n) => fs.readFile(path.join(folder, "history", n), "utf8")));
    assert.ok(kept.includes(p.text), `${stepName}: the person's text is in history/`);
  }
  // A person saving over an agent's text.
  for (const stepName of steps) {
    const { a, c, dir } = await setup();
    const n = (await a.create("agent\n", "?title=T")).json();
    const folder = path.join(dir, "notes", n.id);
    const personText = n.text + "person\n";
    const r = await stoppedAt(stepName, () => c.save(n.id, personText, n.revision));
    assert.equal(r.statusCode, 500);
    const now = (await c.get(`/api/notes/${n.id}`)).json();
    const replaced = stepName === "save:replaced" || stepName === "save:pruned";
    assert.equal(now.text, replaced ? personText : n.text, stepName);
    // Before the writers are written the agent's text is still known as the agent's; after, it
    // counts as a person's (kept longer). The person's text never counts as the agent's.
    assert.equal(now.entry.agent, stepName === "save:history" ? "claude" : null, stepName);
    const next = await a.save(n.id, now.text + "next\n", now.revision);
    assert.equal(next.statusCode, 200, next.body);
    const inAgents = await Promise.all((await names(path.join(folder, "agent-history"))).map((f) => fs.readFile(path.join(folder, "agent-history", f), "utf8")));
    assert.equal(inAgents.includes(personText), false, `${stepName}: the person's text is not among the agents' versions`);
    if (replaced) {
      const inHistory = await Promise.all((await names(path.join(folder, "history"))).map((f) => fs.readFile(path.join(folder, "history", f), "utf8")));
      assert.ok(inHistory.includes(personText), `${stepName}: it is in history/`);
    }
  }
});

test("writers: when writers.json can be neither read nor written, every text is a person's and saves still work", async () => {
  const { a, c, dir } = await setup();
  const n = (await a.create("agent\n", "?title=T")).json();
  const folder = path.join(dir, "notes", n.id);
  // A folder where the file should be: it cannot be read (so all is a person's) or replaced.
  await fs.rm(path.join(folder, "writers.json"));
  await fs.mkdir(path.join(folder, "writers.json"));
  await fs.writeFile(path.join(folder, "writers.json", "x"), "x");
  const file = path.join(folder, "note.md");
  await fs.utimes(file, new Date(), new Date(Date.now() + 5000));
  assert.equal((await a.get(`${A}/items/${n.id}`)).json().entry.agent, null);
  // The agent's save is made, but cannot name itself: the text counts as a person's.
  const viaAgent = await a.save(n.id, n.text + "agent 2\n", n.revision);
  assert.equal(viaAgent.statusCode, 200, viaAgent.body);
  assert.equal(viaAgent.json().entry.agent, null);
  // A person's save goes on.
  const viaPerson = await c.save(n.id, n.text + "person\n", viaAgent.json().revision);
  assert.equal(viaPerson.statusCode, 200, viaPerson.body);
  assert.equal((await names(path.join(folder, "history"))).length, 2);
  assert.equal((await names(folder)).includes("agent-history"), false);
});

test("writers: the trash and a restore keep both folders and the names", async () => {
  const { a, c, dir } = await setup();
  const n = (await a.create("one\n", "?title=T")).json();
  const s1 = (await a.save(n.id, n.text + "two\n", n.revision)).json();
  await c.save(n.id, n.text + "person\n", s1.revision);
  const before = await tree(path.join(dir, "notes", n.id));
  assert.deepEqual(Object.keys(before).map((f) => f.split(path.sep)[0]).sort(), ["agent-history", "agent-history", "note.md", "writers.json"]);
  await c.del(`/api/notes/${n.id}`);
  const trashed = await tree(path.join(dir, "trash", n.id));
  delete trashed["trashed.json"];
  assert.deepEqual(trashed, before);
  await c.post(`/api/trash/${n.id}/restore`);
  assert.deepEqual(await tree(path.join(dir, "notes", n.id)), before);
  assert.deepEqual((await a.get(`${A}/items/${n.id}/history`)).json().versions.map((v: { agent: string | null }) => v.agent), ["claude", "claude"]);
});

// --- the guide (5.1) -----------------------------------------------------------------------------

/** The words of a shell line, with single and double quotes. */
function words(line: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  for (let m = re.exec(line); m; m = re.exec(line)) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : (m[2] ?? m[3]));
  return out;
}

test("the guide: every curl example in it works against a real server, in order", async () => {
  const { s, token } = await setup();
  const guide = (await s.app.inject({ method: "GET", url: A, headers: { host: HOST } })).body;
  const blocks = [...guide.matchAll(/```(\w+)\n([\s\S]*?)```/g)].map((m) => ({ lang: m[1], text: m[2] }));
  const files: Record<string, string> = { "note.md": "- oats\n- two lemons\n", "drawing.excalidraw": blocks.find((b) => b.lang === "json" && b.text.includes('"excalidraw"'))!.text };
  const vars: Record<string, string> = { NOOK_TOKEN: token };
  const curls = blocks.filter((b) => b.lang === "sh").map((b) => b.text.trim());
  assert.equal(curls.length, 9, "the examples of the guide");
  const seen: string[] = [];
  for (const line of curls) {
    assert.ok(line.startsWith("curl "), line);
    const w = words(line.replace(/\$([A-Z_]+)/g, (_, k: string) => vars[k] ?? assert.fail(`$${k} is not known at: ${line}`)));
    let method = "GET";
    let url = "";
    let body: string | undefined;
    const headers: Record<string, string> = {};
    for (let i = 1; i < w.length; i++) {
      if (w[i] === "-sS") continue;
      else if (w[i] === "-X") method = w[++i];
      else if (w[i] === "-H") {
        const [k, ...v] = w[++i].split(":");
        headers[k.trim().toLowerCase()] = v.join(":").trim();
      } else if (w[i] === "--data-binary") {
        const v = w[++i];
        body = v.startsWith("@") ? (files[v.slice(1)] ?? assert.fail(`no file ${v}`)) : v;
      } else if (w[i] === "-o" || w[i] === "-D") i++;
      else if (!w[i].startsWith("-") && url === "") url = w[i];
      else assert.fail(`an option the test does not know: ${w[i]} in ${line}`);
    }
    assert.ok(url.startsWith(`http://${HOST}${A}`), url);
    const r = await s.app.inject({ method: method as "GET", url: url.slice(`http://${HOST}`.length), headers: { host: HOST, ...headers }, payload: body });
    assert.ok(r.statusCode === 200 || r.statusCode === 201, `${line}\n→ ${r.statusCode} ${r.body}`);
    seen.push(`${method} ${url.slice(`http://${HOST}${A}`.length).replace(/[a-z2-7]{24}/, ":id").replace(/\/history\/.+$/, "/history/:version")}`);
    if (String(r.headers["content-type"]).startsWith("application/json")) {
      const j = r.json() as { id?: string; revision?: string; versions?: { version: string }[]; entry?: { kind: string } };
      if (j.id) vars.ID = j.id;
      if (j.revision) vars.REVISION = j.revision;
      if (j.versions?.length) vars.VERSION = j.versions[0].version;
    } else if (url.endsWith("/text")) {
      // What the next example saves: the file as read, with a line more.
      files["note.md"] = r.body + "- bread\n";
      vars.REVISION = String(r.headers.etag).replace(/"/g, "");
    }
  }
  assert.deepEqual(seen, [
    "GET /items",
    "POST /items?title=Shopping&tags=food,home",
    "GET /items/:id",
    "GET /items/:id/text",
    "PUT /items/:id",
    "POST /items/:id/append",
    "GET /items/:id/history",
    "GET /items/:id/history/:version",
    "POST /items?title=Architecture&tags=work",
  ]);
  // What they made: the note of the guide, changed and added to; and the example drawing.
  const list = (await s.app.inject({ method: "GET", url: `${A}/items`, headers: { host: HOST, authorization: `Bearer ${token}` } })).json().entries;
  assert.deepEqual(list.map((e: { title: string; kind: string }) => [e.title, e.kind]).sort(), [["Architecture", "drawing"], ["Shopping", "note"]]);
  const note = list.find((e: { kind: string }) => e.kind === "note");
  const text = (await s.app.inject({ method: "GET", url: `${A}/items/${note.id}`, headers: { host: HOST, authorization: `Bearer ${token}` } })).json().text;
  assert.equal(text, `---\ntitle: "Shopping"\ntags: [food, home]\ncreated: ${today()}\n---\n\n- oats\n- two lemons\n- bread\n\n- olive oil\n`);
});

test("the guide: it names every route, every error code and what a token cannot do", async () => {
  const s = await startServer();
  const guide = (await s.app.inject({ method: "GET", url: A, headers: { host: HOST } })).body;
  for (const code of ["bad-request", "no-token", "not-found", "changed", "trashed", "too-large", "unsupported-type", "refused", "not-utf8", "not-json", "not-excalidraw", "broken-front-matter", "bad-tag", "bad-title", "empty", "missing-image", "no-revision", "busy", "server", "unavailable"]) {
    assert.ok(guide.includes("`" + code + "`"), code);
  }
  for (const d of Object.values(routes) as RouteDef[]) {
    if (d.auth !== "token") continue;
    const shape = d.url.replace(":id", "$ID").replace(":version", "$VERSION");
    assert.ok(guide.includes(`http://${HOST}${shape}`), `${d.method} ${d.url}`);
  }
  for (const word of ["delete", "trash", "restore", "photo", DRAWING_TYPE, "text/markdown", "2 MB", "25 MB", "If-Match", "--data-binary"]) assert.ok(guide.includes(word), word);
  // The example drawing is a drawing a save accepts, with its bindings both ways.
  const example = JSON.parse([...guide.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]).find((t) => t.includes('"excalidraw"'))!);
  const byId = new Map<string, Record<string, unknown>>(example.elements.map((e: { id: string }) => [e.id, e]));
  assert.equal(byId.size, example.elements.length, "ids are different");
  for (const e of example.elements as { id: string; type: string; containerId?: string | null; startBinding?: { elementId: string }; endBinding?: { elementId: string }; boundElements: { id: string; type: string }[] }[]) {
    if (e.containerId) assert.ok((byId.get(e.containerId)!.boundElements as { id: string }[]).some((b) => b.id === e.id), `${e.containerId} names its label ${e.id}`);
    for (const end of [e.startBinding, e.endBinding]) if (end) assert.ok((byId.get(end.elementId)!.boundElements as { id: string }[]).some((b) => b.id === e.id), `${end.elementId} names the arrow ${e.id}`);
    for (const b of e.boundElements) assert.ok(byId.has(b.id), `${e.id} names ${b.id}, which is there`);
  }
  for (const key of ["seed", "versionNonce", "index"]) assert.equal(new Set(example.elements.map((e: Record<string, unknown>) => e[key])).size, example.elements.length, key);
});

test("the guide: its formatting example is a note the format reads as the guide says, and what it says is not read is not", async () => {
  const { s, a } = await setup();
  const guide = (await s.app.inject({ method: "GET", url: A, headers: { host: HOST } })).body;
  const example = [...guide.matchAll(/```markdown\n([\s\S]*?)```/g)].map((m) => m[1]).find((t) => t.includes("spacing:"))!;
  assert.ok(example, "the formatting example");
  // An agent can create it as it stands: it has its own front matter.
  const made = await a.create(example);
  assert.equal(made.statusCode, 201, made.body);
  assert.deepEqual([made.json().entry.title, made.json().entry.tags, made.json().entry.problem], ["Lisbon trip", ["travel"], undefined]);
  assert.equal(made.json().text, example);
  const { html, meta } = renderNote(example);
  // Every form in it is read: no brace is left showing, and each style is where the guide puts it.
  assert.equal(/[{}]/.test(html), false, html);
  assert.equal(html.includes("]"), false, "no bracket of a span is left showing");
  assert.match(html, /<h1 style="color: var\(--note-indigo\)">Lisbon trip<\/h1>/, "a block line under a heading");
  assert.match(html, /<span style="color: var\(--note-red\)">Friday the 14th<\/span>/, "a span");
  assert.match(html, /<u>book the tram tickets<\/u>/, "++underline++");
  assert.match(html, /<mark>sunscreen<\/mark>/, "==highlight==");
  assert.match(html, /<span style="background-color: var\(--note-mint\)">window seat<\/span>/);
  assert.match(html, /<span style="color: var\(--note-white\); background-color: var\(--note-red\); font-size: 1\.25em"><strong>Do not forget the passport<\/strong><\/span>/, "three keys round bold");
  assert.match(html, /<p style="color: var\(--note-gray\); font-size: 0\.875em">This paragraph is grey and small/, "a block line under a paragraph");
  assert.match(html, /<td[^>]*><span style="color: var\(--note-green\)">yes<\/span><\/td>/, "a span in a table cell");
  assert.match(html, /<td[^>]*><mark>no<\/mark><\/td>/);
  assert.deepEqual([meta.font, meta.size], ["serif", "17px"]);
  assert.equal(noteSpacing(example), 1.5);
  // Every colour, size and generic font the table names is one the format takes.
  const row = (key: string) => new RegExp("^\\| `" + key + "` \\| (.*) \\|$", "m").exec(guide)![1];
  const words = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const colours = words(row("color")).filter((w) => !w.startsWith("#"));
  assert.equal(colours.length, 14);
  for (const c of colours) assert.ok(renderNote(`[x]{color=${c}}`).html.includes(`color: var(--note-${c})`), c);
  assert.ok(renderNote("[x]{color=#2b6cb0}").html.includes("color: #2b6cb0"));
  assert.ok(/background-color/.test(renderNote("[x]{bg=highlight}").html) || renderNote("[x]{bg=highlight}").html.includes("<mark>"));
  for (const size of ["xs", "small", "normal", "large", "xl", "xxl", "6px", "200px", "14pt"]) {
    assert.ok(words(row("size")).includes(size), size);
    const out = renderNote(`[x]{size=${size}}`).html;
    assert.ok(size === "normal" ? !/[{}]/.test(out) : out.includes("font-size"), `${size}: ${out}`);
  }
  for (const font of ["serif", "sans", "mono"]) assert.ok(renderNote(`[x]{font=${font}}`).html.includes("font-family"), font);
  assert.ok(renderNote('[x]{font="Source Serif 4"}').html.includes("Source Serif 4"));
  assert.match(renderNote("[x]{underline=yes}").html, /underline|<u>/);
  // What the guide says is not read is shown as typed, or shown plain.
  for (const typed of ["{color = red}", "{Color=red}"]) assert.ok(renderNote(`A line.\n${typed}\n`).html.includes(typed), typed);
  assert.equal(/crimson|[{}\]]/.test(renderNote("[x]{color=crimson}").html), false, "an unknown colour: a plain x, no braces");
  assert.ok(renderNote("<b>x</b>").html.includes("&lt;b&gt;"), "HTML is shown as typed");
  // A block line does not style a list; a span in a list item does.
  assert.ok(renderNote("- one\n- two\n{color=red}\n").html.includes("{color=red}"));
  assert.ok(renderNote("- [one]{color=red}\n").html.includes("color: var(--note-red)"));
});
