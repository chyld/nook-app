// SPEC-AGENTS 9, `web` stores: the Agents section of the Account screen through the API client,
// with a fake server.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ApiError, setClient } from "../src/lib/api.ts";
import { agents } from "../src/stores/agents.svelte.ts";
import { FakeApi } from "./fake.ts";

let api: FakeApi;

beforeEach(() => {
  api = new FakeApi();
  setClient(api.client());
  agents.clear();
});

test("agents: listed, made with the token held until it is closed, and revoked", async () => {
  assert.equal(agents.loaded, false);
  await agents.refresh();
  assert.equal(agents.loaded, true);
  assert.equal(agents.list.length, 0);
  assert.equal(await agents.make("  claude on the laptop "), true);
  assert.equal(agents.made?.agent.name, "claude on the laptop");
  assert.match(agents.made!.token, /^nook_[a-z2-7]{40}$/);
  assert.deepEqual(agents.list.map((a) => a.name), ["claude on the laptop"]);
  // The token is not kept once the person has it.
  agents.close();
  assert.equal(agents.made, null);
  assert.equal(JSON.stringify(agents.list).includes("nook_"), false, "the list never holds a token");
  await agents.refresh();
  assert.deepEqual(agents.list.map((a) => a.name), ["claude on the laptop"], "the server's list is the same");
  assert.equal(await agents.revoke(agents.list[0].id), true);
  assert.deepEqual(agents.list, []);
  assert.deepEqual(api.agents, []);
});

test("agents: a name in use, a bad name and the limit are said, and nothing is added", async () => {
  await agents.make("claude");
  agents.close();
  assert.equal(await agents.make("CLAUDE"), false);
  assert.match(agents.error, /already have an agent with this name/);
  assert.equal(agents.made, null);
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

test("agents: revoking the one just made closes its token; one already gone counts as revoked", async () => {
  await agents.make("claude");
  const id = agents.made!.agent.id;
  assert.equal(await agents.revoke(id), true);
  assert.equal(agents.made, null);
  // Revoked in another tab meanwhile.
  await agents.make("codex");
  agents.close();
  const other = agents.list[0].id;
  api.agents = [];
  assert.equal(await agents.revoke(other), true);
  assert.deepEqual(agents.list, []);
  assert.equal(agents.error, "");
});

test("agents: a failure is said and changes nothing", async () => {
  await agents.make("claude");
  agents.close();
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
