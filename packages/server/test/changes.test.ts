// Findings of the review of alpha's changes (CHANGES-REVIEW-FINDINGS.md) in the server:
// fastify.inject on a temporary folder. Each test names its finding.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Client, PASSWORD, startServer } from "./http.ts";

test("14: a search typed with a space finds a kept space (U+00A0), and the other way round", async () => {
  const s = await startServer();
  await s.ctx.addUser("alice", PASSWORD);
  const alice = new Client(s.app);
  await alice.login("alice", PASSWORD);
  const n = await alice.create("Greeting");
  const r = await alice.save(n.id, `${n.text}hello world\n`, n.revision);
  assert.equal(r.statusCode, 200, r.body);
  const found = (await alice.get(`/api/notes?q=${encodeURIComponent("hello world")}`)).json();
  assert.deepEqual(found.entries.map((e: { id: string }) => e.id), [n.id]);
  assert.match(found.entries[0].excerpt, /hello world/);
  const back = (await alice.get(`/api/notes?q=${encodeURIComponent("hello world")}`)).json();
  assert.deepEqual(back.entries.map((e: { id: string }) => e.id), [n.id]);
});
