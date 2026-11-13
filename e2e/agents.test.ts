// SPEC-AGENTS 9, e2e: a token made and copied on the Account screen; with it, from outside the
// browser, a note and the guide's example drawing created; both in the sidebar with the agent's
// mark, and open; the drawing with its shapes and labels, not unsaved, and the same after a save
// and a reload; an append to a note open in the browser, then the conflict on the person's
// save; revoke, and the next request is 401.
//
// The agent here is this test's own `fetch`, with a token and no cookie.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import { browser, clickEditor, login, newNote, notesText, page, startServer, type Server } from "./harness.ts";

let s: Server;
let b: Browser;

before(async () => {
  s = await startServer();
  await s.addUser("dana");
  b = await browser();
});

after(async () => {
  await b?.close();
  await s?.stop();
});

const A = "/api/agent/v1";
const ready = (p: Page) => p.locator('[data-testid="drawing"][data-ready="true"]').waitFor({ timeout: 30000 });
const waitState = (p: Page, st: string) => p.locator(`[data-testid="save-status"][data-state="${st}"]`).waitFor();
const doc = async (p: Page) => JSON.parse(await p.evaluate(() => (window as unknown as { __drawing: { text(): string } }).__drawing.text()));

async function fresh(): Promise<{ p: Page; errors: string[]; close(): Promise<void> }> {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, permissions: ["clipboard-read", "clipboard-write"] });
  const { page: p, errors } = await page(ctx);
  await login(p, s.url, "dana");
  return { p, errors, close: () => ctx.close() };
}

/** Makes an agent on the Account screen and gives back its token as the Copy button copies it. */
async function makeAgent(p: Page, name: string): Promise<string> {
  await p.goto(`${s.url}/account`);
  await p.getByTestId("agents").waitFor();
  await p.getByTestId("agent-name").fill(name);
  await p.getByTestId("agent-make").click();
  await p.getByTestId("agent-token").waitFor();
  const shown = (await p.getByTestId("agent-token").textContent())!.trim();
  await p.getByTestId("agent-copy").click();
  const copied = await p.evaluate(() => navigator.clipboard.readText());
  assert.equal(copied, shown, "Copy copies the token that is shown");
  assert.match(shown, /^nook_[a-z2-7]{40}$/);
  assert.equal((await p.getByTestId("agent-guide").textContent())!.trim(), `${s.url}${A}`);
  return shown;
}

/** A request as an agent sends it: a token, no cookie, no Origin. */
function agent(token: string) {
  return (method: string, url: string, body?: string, headers: Record<string, string> = {}) =>
    fetch(`${s.url}${url}`, { method, body, headers: { authorization: `Bearer ${token}`, ...headers } });
}

test("a token made on the Account screen; with it a note and the guide's drawing are created, marked, and open", async () => {
  const f = await fresh();
  const { p } = f;
  const token = await makeAgent(p, "Claude on the laptop");
  // The token is shown once: closed, it is not in the page; the row stays.
  await p.getByTestId("agent-close").click();
  assert.equal(await p.getByTestId("agent-token").count(), 0);
  assert.equal(await p.getByTestId("agent-row").count(), 1);
  assert.equal(await p.getByTestId("agent-row").getAttribute("data-name"), "Claude on the laptop");
  assert.equal((await p.content()).includes(token), false);
  await p.reload();
  await p.getByTestId("agent-row").waitFor();
  assert.equal(await p.getByTestId("agent-token").count(), 0, "not shown again");

  // The agent reads the guide (no token needed) and works from it.
  const guide = await (await fetch(`${s.url}${A}`)).text();
  assert.ok(guide.includes(`${s.url}${A}/items`), "the guide has this server's address");
  const example = [...guide.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]).find((t) => t.includes('"excalidraw"'))!;
  const req = agent(token);
  const note = await req("POST", `${A}/items?title=From%20the%20agent&tags=robot`, "- written by a program\n", { "content-type": "text/markdown" });
  assert.equal(note.status, 201);
  const n = (await note.json()) as { id: string; url: string };
  assert.equal(n.url, `${s.url}/n/${n.id}`);
  const made = await req("POST", `${A}/items?title=Architecture`, example, { "content-type": "application/vnd.excalidraw+json" });
  assert.equal(made.status, 201, await made.clone().text());
  const d = (await made.json()) as { id: string; url: string };

  // Both are in the sidebar, each with the agent's mark.
  await p.goto(s.url);
  const row = (id: string) => p.locator(`[data-testid="note-row"][data-id="${id}"]`);
  await row(n.id).waitFor();
  assert.equal(await row(n.id).getAttribute("data-agent"), "Claude on the laptop");
  assert.equal(await row(d.id).getAttribute("data-agent"), "Claude on the laptop");
  assert.equal(await row(d.id).getAttribute("data-kind"), "drawing");
  assert.equal(await row(n.id).getByTestId("agent-mark").count(), 1);

  // The note opens, with its title and tag, and says who wrote it.
  await row(n.id).click();
  await p.getByTestId("editor").waitFor();
  await p.waitForFunction(() => (window as unknown as { __notes?: unknown }).__notes !== undefined);
  assert.ok((await notesText(p)).includes("written by a program"));
  assert.equal((await p.getByTestId("written-by").textContent())!.trim(), "Written by Claude on the laptop");
  assert.equal((await p.getByTestId("note-title").textContent())!.trim(), "From the agent");

  // The drawing opens at the address the agent was given, with its shapes and labels, not unsaved.
  await p.goto(d.url);
  await ready(p);
  assert.equal(await p.getByTestId("save-status").getAttribute("data-state"), "saved", "an agent's drawing does not open unsaved");
  assert.equal((await p.getByTestId("written-by").textContent())!.trim(), "Written by Claude on the laptop");
  const opened = await doc(p);
  const byType = (els: { type: string }[], t: string) => els.filter((e) => e.type === t);
  assert.equal(byType(opened.elements, "rectangle").length, 2);
  assert.equal(byType(opened.elements, "arrow").length, 1);
  assert.deepEqual(byType(opened.elements, "text").map((e) => (e as unknown as { originalText: string }).originalText).sort(), ["Browser", "One save, whole document", "Server"]);
  const el = (els: { id: string }[], id: string) => els.find((e) => e.id === id) as unknown as Record<string, unknown>;
  assert.equal(el(opened.elements, "label-a").containerId, "box-a", "the label is still in its box");
  assert.equal((el(opened.elements, "arrow-ab").startBinding as { elementId: string }).elementId, "box-a", "the arrow is still bound");
  assert.equal((el(opened.elements, "arrow-ab").endBinding as { elementId: string }).elementId, "box-b");
  assert.equal(opened.nook.title, "Architecture");

  // A person changes it and saves: the mark goes, and after a reload it is what was saved.
  await p.evaluate(() => (window as unknown as { __drawing: { addText(t: string, x: number, y: number): void } }).__drawing.addText("added by a person", 0, 220));
  await waitState(p, "dirty");
  await p.getByTestId("save").click();
  await waitState(p, "saved");
  assert.equal(await p.getByTestId("written-by").count(), 0, "a person saved a change");
  const saved = await doc(p);
  await p.reload();
  await ready(p);
  assert.equal(await p.getByTestId("save-status").getAttribute("data-state"), "saved");
  const again = await doc(p);
  assert.deepEqual(again.elements.map((e: { id: string; type: string; x: number; y: number }) => [e.id, e.type, e.x, e.y]), saved.elements.map((e: { id: string; type: string; x: number; y: number }) => [e.id, e.type, e.x, e.y]), "unchanged after a save and a reload");
  assert.equal(again.elements.length, 7);

  // Its history says the version the person replaced was the agent's.
  await p.goto(`${s.url}/d/${d.id}/history`);
  await p.getByTestId("history-row").first().waitFor();
  assert.equal(await p.getByTestId("history-row").first().getAttribute("data-agent"), "Claude on the laptop");
  assert.deepEqual(f.errors.filter((e) => /Content Security Policy|Refused to/i.test(e)), []);
  await f.close();
});

test("an agent appends to a note open in the browser; the person's next save is a conflict; revoked, the token is refused", async () => {
  const f = await fresh();
  const { p } = f;
  const token = await makeAgent(p, "Appender");
  const req = agent(token);
  await p.goto(s.url);
  await p.getByTestId("sidebar").waitFor();
  const id = await newNote(p);
  await clickEditor(p);
  await p.keyboard.type("Typed by a person");
  await p.getByTestId("save").click();
  await waitState(p, "saved");

  // The agent adds a line, with no revision, while the note is open.
  const r = await req("POST", `${A}/items/${id}/append`, "- added by the agent", { "content-type": "text/markdown" });
  assert.equal(r.status, 200, await r.clone().text());
  const after = (await (await req("GET", `${A}/items/${id}`)).json()) as { text: string; entry: { agent: string | null } };
  assert.ok(after.text.endsWith("Typed by a person\n\n- added by the agent\n"), JSON.stringify(after.text));
  assert.equal(after.entry.agent, "Appender");

  // The person, who has not seen it, types and saves: a conflict, as with two tabs.
  await clickEditor(p);
  await p.keyboard.type(" and more");
  await p.getByTestId("save").click();
  await p.getByTestId("conflict-theirs").waitFor();
  await p.getByTestId("conflict-theirs").click();
  await p.waitForFunction(() => (window as unknown as { __notes: { text(): string } }).__notes.text().includes("- added by the agent"));
  assert.equal((await p.getByTestId("written-by").textContent())!.trim(), "Written by Appender");

  // No route lets the agent delete it, with or without the person's cookie beside the token.
  for (const method of ["DELETE", "PATCH"]) {
    const gone = await req(method, `${A}/items/${id}`);
    assert.equal(gone.status, 404);
    assert.equal(((await gone.json()) as { error: { code: string; hint: string } }).error.code, "not-found");
  }
  assert.equal((await req("DELETE", `/api/notes/${id}`, undefined, { origin: s.url })).status, 401, "a token is not a session");
  assert.equal((await req("GET", `${A}/items/${id}`)).status, 200, "the note is still there");

  // Revoked on the Account screen: the next request is refused.
  await p.goto(`${s.url}/account`);
  await p.locator('[data-testid="agent-row"][data-name="Appender"]').getByTestId("agent-revoke").click();
  await p.getByTestId("confirm").click();
  await p.locator('[data-testid="agent-row"][data-name="Appender"]').waitFor({ state: "detached" });
  const refused = await req("GET", `${A}/items`);
  assert.equal(refused.status, 401);
  const body = (await refused.json()) as { error: { code: string; hint: string } };
  assert.equal(body.error.code, "no-token");
  assert.ok(body.error.hint.includes(`${s.url}${A}`));
  await f.close();
});
