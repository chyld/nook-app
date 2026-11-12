// SPEC2 6 and 12: fonts, against a fake Google server on localhost. Tests never contact Google.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { Client, PASSWORD, startServer, type TestServer } from "./http.ts";
import { parseFontList, slugOf } from "../src/fonts.ts";
import { CATALOGUE, fakeGoogle, type Fake } from "./fakegoogle.ts";

let google: Fake;
let s: TestServer;
let alice: Client;
let bob: Client;

before(async () => {
  google = await fakeGoogle({ extra: 70 });
  s = await startServer({ google: { list: google.base, css: google.base, files: google.base }, googleInsecure: true });
  await s.ctx.addUser("alice", PASSWORD);
  await s.ctx.addUser("bob", PASSWORD);
  alice = new Client(s.app);
  bob = new Client(s.app);
  bob.ip = "198.51.100.3";
  await alice.login("alice");
  await bob.login("bob");
});

after(async () => {
  await google?.close();
});

test("the catalogue: pages of families with the total, by name and category; cached", async () => {
  const r = (await alice.get("/api/fonts/catalogue")).json();
  assert.equal(r.available, true);
  assert.equal(r.families.length, 30, "a page");
  assert.equal(r.total, 74);
  assert.equal(r.families[0].slug, "inter", "most popular first");
  assert.ok(r.categories.includes("Handwriting"));
  const more = (await alice.get("/api/fonts/catalogue?offset=30")).json();
  assert.notEqual(more.families[0].slug, r.families[0].slug);
  assert.deepEqual((await alice.get("/api/fonts/catalogue?q=cav")).json().families.map((f: { slug: string }) => f.slug), ["caveat"]);
  assert.equal((await alice.get("/api/fonts/catalogue?category=Handwriting")).json().total, 1);
  const cached = JSON.parse(await fs.readFile(path.join(s.root, "cache", "google-fonts.json"), "utf8"));
  assert.equal(cached.version, 2);
  assert.ok(google.requests.every((x) => /Chrome/.test(x.ua)), "a current browser's user agent");
});

test("previews: a font of the family's name only, cached for everyone", async () => {
  const r = await alice.get("/api/fonts/preview/caveat");
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers["content-type"], "font/woff2");
  assert.equal(r.headers["cache-control"], "private");
  assert.ok(await fs.stat(path.join(s.root, "cache", "font-previews", "caveat.woff2")));
  assert.equal((await alice.get("/api/fonts/preview/not-there")).statusCode, 404);
  assert.equal((await alice.get("/api/fonts/preview/BAD")).statusCode, 400);
});

test("add, list, css, files and remove a font; latin and latin-ext only; per user", async () => {
  const add = await alice.post("/api/fonts", { slug: "caveat" });
  assert.equal(add.statusCode, 200, add.body);
  assert.deepEqual(add.json().fonts, [{ family: "Caveat", slug: "caveat" }]);
  assert.equal((await alice.post("/api/fonts", { slug: "caveat" })).statusCode, 409);
  assert.equal((await alice.post("/api/fonts", { slug: "noto-sans-jp" })).statusCode, 404, "not in the catalogue (no latin)");
  const css = (await alice.get("/api/fonts.css")).body;
  assert.ok(css.includes("font-family: 'Caveat'"));
  assert.ok(!css.includes("cyrillic") && !css.includes("javascript") && !css.includes(google.base), "only latin, latin-ext; only our own addresses");
  const file = /url\((\/api\/fonts\/caveat\/[^)]+)\)/.exec(css)![1];
  const f = await alice.get(file);
  assert.equal(f.statusCode, 200);
  assert.equal(f.headers["content-type"], "font/woff2");
  assert.equal((await bob.get(file)).statusCode, 404, "bob has no such font");
  assert.equal((await bob.get("/api/fonts")).json().fonts.length, 0);
  assert.equal((await bob.get("/api/fonts.css")).body, "");
  assert.equal((await alice.del("/api/fonts/caveat")).statusCode, 200);
  assert.equal((await alice.del("/api/fonts/caveat")).statusCode, 404);
  assert.deepEqual((await alice.get("/api/fonts")).json().fonts, []);
});

test("fetching rules: no redirects, at most 5 MB, only Google's addresses", async () => {
  google.mode.redirect = true;
  assert.equal((await alice.post("/api/fonts", { slug: "inter" })).statusCode, 502);
  google.mode.redirect = false;
  google.mode.huge = true;
  assert.equal((await alice.post("/api/fonts", { slug: "inter" })).statusCode, 502);
  google.mode.huge = false;
  google.mode.notWoff = true;
  assert.equal((await alice.post("/api/fonts", { slug: "inter" })).statusCode, 502);
  google.mode.notWoff = false;
  assert.equal((await alice.post("/api/fonts", { slug: "inter" })).statusCode, 200);
  assert.deepEqual(await fs.readdir(path.join(s.root, "users", s.ctx.accounts.byName("alice")!.id, "tmp")), [], "nothing left in tmp/");
});

test("the font list's shape is checked", () => {
  assert.equal(slugOf("IBM Plex Serif"), "ibm-plex-serif");
  assert.deepEqual(parseFontList(`)]}'\n${JSON.stringify(CATALOGUE)}`).map((f) => f.slug), ["inter", "caveat", "ibm-plex-serif", "only-ext"]);
  assert.throws(() => parseFontList("{}"));
});

test("at most 40 families per user", async () => {
  const u = s.ctx.accounts.byName("bob")!.id;
  const dir = path.join(s.root, "users", u, "fonts");
  for (let i = 0; i < 40; i++) {
    await fs.mkdir(path.join(dir, `f${i}`));
    await fs.writeFile(path.join(dir, `f${i}`, "font.css"), `@font-face { font-family: 'F${i}'; }`);
  }
  const r = await bob.post("/api/fonts", { slug: "caveat" });
  assert.equal(r.statusCode, 409);
});
