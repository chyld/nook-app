// SPEC-AGENTS 9, `web` stores: the Agents section of the Account screen through the API client,
// with a fake server. Each agent keeps its token on the screen (the owner's choice).

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ApiError, setClient } from "../src/lib/api.ts";
import { agents } from "../src/stores/agents.svelte.ts";
import { session } from "../src/stores/session.svelte.ts";
import { drafts } from "../src/stores/drafts.svelte.ts";
import { FakeApi, FakeStorage } from "./fake.ts";

let api: FakeApi;

beforeEach(() => {
  api = new FakeApi();
  setClient(api.client());
  drafts.useStorage(new FakeStorage());
  agents.clear();
});

test("agents: made with its token, which stays in the list, also after the list is read again; and revoked", async () => {
  assert.equal(agents.loaded, false);
  await agents.refresh();
  assert.equal(agents.loaded, true);
  assert.equal(agents.list.length, 0);
  assert.equal(await agents.make("  claude on the laptop "), true);
  assert.deepEqual(agents.list.map((a) => a.name), ["claude on the laptop"]);
  const token = agents.list[0].token;
  assert.match(token ?? "", /^nook_[a-z2-7]{40}$/);
  // It is not shown once: the server lists it again, as on a reload of the page.
  agents.clear();
  await agents.refresh();
  assert.deepEqual(agents.list.map((a) => [a.name, a.token]), [["claude on the laptop", token]]);
  assert.equal(await agents.revoke(agents.list[0].id), true);
  assert.equal(agents.list.length, 0);
  assert.deepEqual(api.agents, []);
});

test("agents: several can be made one after another, each with its own token", async () => {
  for (const name of ["claude", "codex", "grok"]) assert.equal(await agents.make(name), true);
  assert.deepEqual(agents.list.map((a) => a.name), ["claude", "codex", "grok"]);
  assert.equal(new Set(agents.list.map((a) => a.token)).size, 3);
});

test("agents: an agent made before tokens were kept has none to show", async () => {
  api.agents.push({ id: "oldoldoldoldoldo", name: "old", created: "2026-11-12T10:00:00.000Z", used: null, token: null });
  await agents.refresh();
  assert.deepEqual(agents.list.map((a) => [a.name, a.token]), [["old", null]]);
});

test("agents: a name in use, a bad name and the limit are said, and nothing is added", async () => {
  await agents.make("claude");
  assert.equal(await agents.make("CLAUDE"), false);
  assert.match(agents.error, /already have an agent with this name/);
  assert.equal(agents.list.length, 1);
  assert.equal(await agents.make("   "), false);
  assert.match(agents.error, /1 to 40 characters/);
  // The next request that works clears the message.
  assert.equal(await agents.make("codex"), true);
  assert.equal(agents.error, "");
  for (let i = 3; i <= 20; i++) assert.equal(await agents.make(`agent ${i}`), true);
  assert.equal(await agents.make("one too many"), false);
  assert.match(agents.error, /at most 20/);
  assert.equal(agents.list.length, 20);
});

test("agents: one already gone counts as revoked", async () => {
  await agents.make("codex");
  const other = agents.list[0].id;
  // Revoked in another tab meanwhile.
  api.agents = [];
  assert.equal(await agents.revoke(other), true);
  assert.equal(agents.list.length, 0);
  assert.equal(agents.error, "");
});

test("agents: a failure is said and changes nothing", async () => {
  await agents.make("claude");
  const c = api.client();
  setClient({ ...c, agents: () => Promise.reject(new ApiError(0, "offline", "The server could not be reached.")), agentRevoke: () => Promise.reject(new ApiError(500, "server", "Something went wrong on the server.")) });
  await agents.refresh();
  assert.match(agents.error, /could not be reached/);
  assert.equal(agents.list.length, 1, "the list it had stays");
  assert.equal(await agents.revoke(agents.list[0].id), false);
  assert.match(agents.error, /went wrong/);
  assert.equal(agents.list.length, 1);
});

test("agents: two presses make one agent", async () => {
  const [a, b] = await Promise.all([agents.make("claude"), agents.make("claude")]);
  assert.deepEqual([a, b], [true, false]);
  assert.equal(api.agents.length, 1);
  assert.equal(agents.error, "", "the second press is not an error");
});

test("agents (review): a token that arrives after the session ended is not kept in the page", async () => {
  await session.login("alice", "x");
  const c = api.client();
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  setClient({ ...c, agentMake: async (name) => (await held, c.agentMake(name)) });
  const making = agents.make("claude");
  await session.logout();
  release();
  assert.equal(await making, false);
  assert.equal(agents.list.length, 0, "the next person to log in here is not shown it");
  assert.equal(agents.error, "");
});

test("agents (review): when the session ends, the list and its tokens are gone from the page", async () => {
  await session.login("alice", "x");
  await agents.make("claude");
  assert.equal(agents.list.length, 1);
  await session.logout();
  assert.equal(agents.list.length, 0, "the next person to log in here does not see them");
  assert.equal(agents.loaded, false);
});
