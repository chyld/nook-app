// SPEC2 12, e2e: seven journeys under the real content security policy, by test id only (and
// window.__notes): typing by composition; log in and create; type and style in Rich, switch to
// Raw, save, reload; upload and resize a photo; edit a table; conflict in two tabs; trash and
// restore.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import type { Browser, Page } from "playwright";
import { browser, clickEditor, login, newNote, notesText, page, startServer, type Server } from "./harness.ts";

let s: Server;
let b: Browser;

before(async () => {
  s = await startServer();
  await s.addUser("alice");
  b = await browser();
});

after(async () => {
  await b?.close();
  await s?.stop();
});

const policyErrors = (errors: string[]) => errors.filter((e) => /Content Security Policy|Refused to/i.test(e));
const save = async (p: Page) => {
  await p.getByTestId("save").click();
  await p.locator('[data-testid="save-status"][data-state="saved"]').waitFor();
};
const intent = (p: Page, i: unknown) => p.evaluate((x) => (window as unknown as { __notes: { intent(i: unknown): boolean } }).__notes.intent(x), i);
const select = (p: Page, from: number, to: number) => p.evaluate(([a, z]) => (window as unknown as { __notes: { select(a: number, z: number): void } }).__notes.select(a, z), [from, to]);
const bodyOf = (t: string) => t.replace(/^---\n[\s\S]*?\n---\n\n?/, "");

async function fresh(): Promise<{ p: Page; errors: string[]; close: () => Promise<void> }> {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const { page: p, errors } = await page(ctx);
  await login(p, s.url, "alice");
  return { p, errors, close: () => ctx.close() };
}

test("log in and create: a wrong password is refused; a new note opens in the editor", async () => {
  const ctx = await b.newContext();
  const { page: p, errors } = await page(ctx);
  await p.goto(`${s.url}/`);
  await p.getByTestId("login-username").waitFor();
  await p.getByTestId("login-username").fill("alice");
  await p.getByTestId("login-password").fill("not the password");
  await p.getByTestId("login-submit").click();
  await p.getByTestId("login-error").waitFor();
  await p.getByTestId("login-password").fill("correct horse battery");
  await p.getByTestId("login-submit").click();
  await p.getByTestId("sidebar").waitFor();
  const id = await newNote(p);
  assert.match(id, /^[a-z2-7]{24}$/);
  await p.locator(`[data-testid="note-row"][data-id="${id}"]`).waitFor();
  assert.equal(await p.getByTestId("editor").getAttribute("data-mode"), "rich");
  assert.equal(await p.getByTestId("save-status").getAttribute("data-state"), "saved");
  assert.deepEqual(policyErrors(errors), []);
  await ctx.close();
});

test("type and style in Rich, switch to Raw, save, reload", async () => {
  const { p, errors, close } = await fresh();
  await newNote(p);
  await clickEditor(p);
  await p.keyboard.type("Hello world");
  assert.equal(bodyOf(await notesText(p)), "Hello world");
  // Select "world" and make it bold from the toolbar, then italic with the key.
  const t = await notesText(p);
  await select(p, t.indexOf("world"), t.indexOf("world") + 5);
  await p.getByTestId("cmd-bold").click();
  assert.equal(bodyOf(await notesText(p)), "Hello **world**");
  await p.keyboard.press("Control+i");
  assert.equal(bodyOf(await notesText(p)), "Hello ***world***");
  // A bullet from the List menu.
  await p.getByTestId("cmd-list").click();
  await p.locator('[data-testid="menu-item"][data-value="bullet"]').click();
  assert.equal(bodyOf(await notesText(p)), "- Hello ***world***");
  await p.getByTestId("save-status").and(p.locator('[data-state="dirty"]')).waitFor();
  // Raw: the same text, the same caret.
  await p.getByTestId("mode-toggle").click();
  assert.equal(await p.getByTestId("editor").getAttribute("data-mode"), "raw");
  await p.keyboard.press("End");
  await p.keyboard.type("\n\nMore *text*");
  await save(p);
  await p.reload();
  await p.getByTestId("editor").waitFor();
  await p.waitForFunction(() => (window as unknown as { __notes?: unknown }).__notes !== undefined);
  assert.equal(bodyOf(await notesText(p)), "- Hello ***world***\n\nMore *text*");
  assert.equal(await p.getByTestId("editor").getAttribute("data-mode"), "raw", "the last mode is remembered");
  await p.getByTestId("mode-toggle").click();
  assert.equal(await p.getByTestId("editor").getAttribute("data-mode"), "rich");
  // The Raw preview renders the note.
  await p.getByTestId("mode-toggle").click();
  await p.getByTestId("tab-preview").click();
  await p.getByTestId("preview").locator("ul li").waitFor();
  await p.getByTestId("tab-write").click();
  await p.getByTestId("mode-toggle").click();
  assert.deepEqual(policyErrors(errors), []);
  await close();
});

test("normal text only: no Block style menu; `# ` and `> ` typed in Rich stay as typed (SPEC-PLAIN 5.1, 5.2)", async () => {
  const { p, errors, close } = await fresh();
  await newNote(p);
  assert.equal(await p.getByTestId("editor").getAttribute("data-mode"), "rich");
  // The toolbar: the List and Insert menus, and no Block style menu.
  await p.getByTestId("cmd-list").waitFor();
  await p.getByTestId("cmd-insert").waitFor();
  assert.equal(await p.getByTestId("cmd-block").count(), 0, "no Block style control");
  await clickEditor(p);
  await p.keyboard.type("# Title");
  await p.keyboard.press("Enter");
  await p.keyboard.type("> quoted");
  // The file: both lines are there, and neither starts a heading or a quote.
  const body = bodyOf(await notesText(p));
  assert.ok(body.includes("# Title") && body.includes("> quoted"), JSON.stringify(body));
  assert.deepEqual(body.split("\n").filter((line) => /^ {0,3}(#{1,6}(\s|$)|>)/.test(line)), [], JSON.stringify(body));
  // The screen: the characters as typed, drawn as ordinary lines.
  const shown = await p.getByTestId("editor").innerText();
  assert.ok(shown.includes("# Title"), JSON.stringify(shown));
  assert.ok(shown.includes("> quoted"), JSON.stringify(shown));
  // Saved and opened again, it is still text: the preview draws no heading and no quote.
  await save(p);
  await p.getByTestId("mode-toggle").click();
  await p.getByTestId("tab-preview").click();
  await p.getByTestId("preview").getByText("# Title").waitFor();
  assert.equal(await p.getByTestId("preview").locator("h1, h2, h3, h4, h5, h6, blockquote, pre").count(), 0);
  await p.getByTestId("tab-write").click();
  await p.getByTestId("mode-toggle").click();
  assert.deepEqual(policyErrors(errors), []);
  await close();
});

test("typing by composition (an IME), right after ordinary typing and over a selection, then undo", async () => {
  const { p, errors, close } = await fresh();
  await newNote(p);
  await clickEditor(p);
  await p.keyboard.type("Hi ");
  const cdp = await p.context().newCDPSession(p);
  const composeText = async (steps: string[], commit: string) => {
    for (const st of steps) await cdp.send("Input.imeSetComposition", { text: st, selectionStart: st.length, selectionEnd: st.length });
    await cdp.send("Input.insertText", { text: commit });
    await p.waitForTimeout(150);
  };
  await composeText(["ㅎ", "하", "한"], "한");
  assert.equal(bodyOf(await notesText(p)), "Hi 한");
  await p.keyboard.type("!");
  assert.equal(bodyOf(await notesText(p)), "Hi 한!");
  // Over a selection.
  const t = await notesText(p);
  await select(p, t.indexOf("Hi"), t.indexOf("Hi") + 2);
  await composeText(["ㅇ", "안", "안ㄴ", "안녕"], "안녕");
  assert.equal(bodyOf(await notesText(p)), "안녕 한!");
  // Inside bold: the composed text takes the style around it.
  const t2 = await notesText(p);
  await select(p, t2.indexOf("한"), t2.indexOf("한") + 1);
  await intent(p, { type: "setMark", change: { kind: "bold", on: true } });
  const t3 = await notesText(p);
  await select(p, t3.indexOf("한") + 1, t3.indexOf("한") + 1);
  await composeText(["ㄱ", "글"], "글");
  assert.equal(bodyOf(await notesText(p)), "안녕 **한글**!");
  // Undo: each composition goes back as one step to the text it replaced.
  await p.keyboard.press("Control+z");
  assert.equal(bodyOf(await notesText(p)), "안녕 **한**!");
  await p.keyboard.press("Control+z");
  assert.equal(bodyOf(await notesText(p)), "안녕 한!");
  await p.keyboard.press("Control+z");
  assert.equal(bodyOf(await notesText(p)), "Hi 한!");
  assert.deepEqual(policyErrors(errors), []);
  await close();
});

test("upload and resize a photo", async () => {
  const { p, errors, close } = await fresh();
  const id = await newNote(p);
  await clickEditor(p);
  await p.keyboard.type("A photo:");
  const png = await sharp({ create: { width: 800, height: 400, channels: 3, background: "#3366cc" } }).png().toBuffer();
  await p.getByTestId("photo-input").setInputFiles({ name: "Blue Sky.png", mimeType: "image/png", buffer: png });
  await p.getByTestId("photo").waitFor();
  assert.match(await notesText(p), /!\[\]\(note\.assets\/BlueSky\.png\)/);
  const img = p.getByTestId("photo").locator("img");
  await img.waitFor();
  await p.waitForFunction(() => {
    const i = document.querySelector('[data-testid="photo"] img') as HTMLImageElement | null;
    return !!i && i.complete && i.naturalWidth > 0;
  });
  assert.equal(await img.getAttribute("src"), `/api/notes/${id}/assets/BlueSky.png`);
  // The handles show (and take the pointer) while the photo is under it (review of alpha's
  // changes, 10): the pointer goes over the photo first, as a person's does.
  const photo = (await p.getByTestId("photo").boundingBox())!;
  await p.mouse.move(photo.x + photo.width / 2, photo.y + photo.height / 2);
  const handle = p.getByTestId("photo-handle");
  const box = (await handle.boundingBox())!;
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  await p.mouse.move(box.x - 200, box.y + 5, { steps: 6 });
  await p.mouse.up();
  await p.waitForFunction(() => /\{width=\d+%\}/.test((window as unknown as { __notes: { text(): string } }).__notes.text()));
  const width = Number(/\{width=(\d+)%\}/.exec(await notesText(p))![1]);
  assert.ok(width >= 5 && width < 100, `width ${width}`);
  await save(p);
  assert.deepEqual(policyErrors(errors), []);
  await close();
});

test("edit a table: type in a cell, Tab to the next, add a row and a column, style a cell", async () => {
  const { p, errors, close } = await fresh();
  await newNote(p);
  await clickEditor(p);
  await p.keyboard.type("Table:");
  await p.getByTestId("cmd-insert").click();
  await p.locator('[data-testid="menu-item"][data-value="table"]').click();
  await p.getByTestId("table").waitFor();
  const cell = (r: number, c: number) => p.locator(`[data-testid="table-cell"][data-row="${r}"][data-col="${c}"]`);
  await cell(1, 0).click();
  await p.keyboard.type("apples");
  await p.keyboard.press("Tab");
  await p.keyboard.type("3");
  await p.keyboard.press("Enter");
  // Enter in the last row adds a row and moves into it.
  await cell(2, 1).waitFor();
  await p.keyboard.type("4");
  await p.getByTestId("table-add-column").click();
  await cell(0, 2).waitFor();
  let md = await notesText(p);
  assert.match(md, /\| apples \| 3 \| *\|/);
  assert.match(md, /\| *\| 4 \| *\|/, "the focused cell's text was written with the column");
  // A style on a whole cell from the toolbar.
  await cell(1, 0).click();
  await p.getByTestId("cmd-bold").click();
  await p.waitForFunction(() => (window as unknown as { __notes: { text(): string } }).__notes.text().includes("**apples**"));
  // Escape discards what was typed in a cell.
  await cell(1, 1).click();
  await p.keyboard.type("999");
  await p.keyboard.press("Escape");
  md = await notesText(p);
  assert.ok(!md.includes("999"));
  // Undo takes back the last table edit as one step.
  await clickEditor(p);
  await p.keyboard.press("Control+z");
  assert.ok(!(await notesText(p)).includes("**apples**"));
  assert.deepEqual(policyErrors(errors), []);
  await close();
});

test("a saved style in a table cell: two styles in two cells, one undo, the size box, typing after (SPEC-CELLS)", async () => {
  const { p, errors, close } = await fresh();
  // Two saved styles, as the Styles screen would save them.
  const saved = await p.evaluate(async () => {
    const base = { bold: false, italic: false, underline: false, strike: false, size: null, font: null, color: null, bg: null };
    const put = (style: Record<string, unknown>) => fetch(`/api/styles/${encodeURIComponent(String(style.name))}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ style }) }).then((r) => r.status);
    return [await put({ ...base, name: "Loud", bold: true, size: 18, color: "red" }), await put({ ...base, name: "Quiet", italic: true, color: "blue" })];
  });
  assert.deepEqual(saved, [200, 200]);
  await p.reload();
  await p.getByTestId("sidebar").waitFor();
  await newNote(p);
  await clickEditor(p);
  await p.keyboard.type("Table:");
  await p.getByTestId("cmd-insert").click();
  await p.locator('[data-testid="menu-item"][data-value="table"]').click();
  await p.getByTestId("table").waitFor();
  const cell = (r: number, c: number) => p.locator(`[data-testid="table-cell"][data-row="${r}"][data-col="${c}"]`);
  const pick = async (name: string) => {
    await p.getByTestId("cmd-styles").click();
    await p.locator(`[data-testid="menu-item"][data-value="${name}"]`).click();
  };
  const has = (part: string) => p.waitForFunction((x) => (window as unknown as { __notes: { text(): string } }).__notes.text().includes(x), part);
  await cell(1, 0).click();
  await p.keyboard.type("apples");
  await p.keyboard.press("Tab");
  await p.keyboard.type("pears");
  // With only the caret in the cell: the whole cell takes the style, and no message refuses it.
  await cell(1, 0).click();
  await pick("Loud");
  await has("| [**apples**]{size=18pt color=red} |");
  assert.equal(await p.getByText("not inside a table cell").count(), 0);
  // What is typed next is added to the cell's text, not put in its place.
  await p.keyboard.type("!");
  await cell(1, 1).click();
  await has("[**apples!**]{");
  // Another style in another cell, with its text selected.
  await p.keyboard.press("Control+a");
  await pick("Quiet");
  await has("| [*pears*]{color=blue} |");
  let md = await notesText(p);
  assert.match(md, /\| \[\*\*apples!\*\*\]\{[^}]*color=red[^}]*\} \| \[\*pears\*\]\{color=blue\} \|/, "each cell has its own style");
  // The style is drawn in the cell.
  const drawn = await cell(1, 1).evaluate((el) => {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let t: Node | null;
    while ((t = w.nextNode())) if ((t.textContent ?? "").trim()) break;
    return getComputedStyle(t?.parentElement ?? el).fontStyle;
  });
  assert.equal(drawn, "italic");
  // One undo takes the whole style back.
  await clickEditor(p);
  await p.keyboard.press("Control+z");
  await p.waitForFunction(() => !(window as unknown as { __notes: { text(): string } }).__notes.text().includes("color=blue"));
  assert.ok((await notesText(p)).includes("| pears |"), "the cell is plain again after one undo");
  // The size box, then another control: both land in the cell, and nothing goes to the note's text.
  await cell(1, 1).click();
  await p.getByTestId("cmd-size").fill("16");
  await p.getByTestId("cmd-size").press("Enter");
  await has("size=16pt");
  await p.getByTestId("cmd-italic").click();
  await has("[*pears*]{size=16pt}");
  md = await notesText(p);
  assert.ok(md.includes("Table:\n"), "the note's own text is as it was");
  // The same style picked twice changes nothing the second time; the pick after it still lands.
  await pick("Loud");
  await has("size=18pt color=red");
  await pick("Loud");
  await pick("Quiet");
  await has("| [*pears*]{color=blue} |");
  // Default (reset) clears the cell.
  await pick("reset");
  await p.waitForFunction(() => /\| pears \|/.test((window as unknown as { __notes: { text(): string } }).__notes.text()));
  assert.deepEqual(policyErrors(errors), []);
  await close();
});

test("conflict in two tabs: Keep mine, then Take theirs", async () => {
  const one = await fresh();
  const id = await newNote(one.p);
  await clickEditor(one.p);
  await one.p.keyboard.type("first");
  await save(one.p);
  const two = await fresh();
  await two.p.goto(`${s.url}/n/${id}`);
  await two.p.getByTestId("editor").waitFor();
  await two.p.waitForFunction(() => (window as unknown as { __notes?: unknown }).__notes !== undefined);
  await clickEditor(two.p);
  await two.p.keyboard.press("Control+End");
  await two.p.keyboard.type(" from two");
  await save(two.p);
  // Tab one saves from the old revision: 409, its text is kept.
  await one.p.keyboard.type(" from one");
  await one.p.getByTestId("save").click();
  await one.p.getByTestId("conflict-mine").waitFor();
  assert.equal(await one.p.getByTestId("save-status").getAttribute("data-state"), "error");
  assert.equal(bodyOf(await notesText(one.p)), "first from one");
  await one.p.getByTestId("conflict-mine").click();
  await one.p.locator('[data-testid="save-status"][data-state="saved"]').waitFor();
  // Now tab two is behind: Take theirs loads tab one's text and keeps its own as a draft.
  await two.p.keyboard.type(" again");
  await two.p.getByTestId("save").click();
  await two.p.getByTestId("conflict-theirs").click();
  await two.p.waitForFunction(() => (window as unknown as { __notes: { text(): string } }).__notes.text().endsWith("first from one"));
  assert.equal(await two.p.getByTestId("save-status").getAttribute("data-state"), "saved");
  // Its text was kept: the draft is offered when the note is opened again.
  await two.p.reload();
  await two.p.getByTestId("draft-row").first().waitFor();
  await two.p.getByTestId("draft-open").first().click();
  await two.p.waitForFunction(() => (window as unknown as { __notes: { text(): string } }).__notes.text().endsWith("first from two again"));
  assert.deepEqual([...policyErrors(one.errors), ...policyErrors(two.errors)], []);
  await one.close();
  await two.close();
});

test("trash and restore", async () => {
  const { p, errors, close } = await fresh();
  const id = await newNote(p);
  await clickEditor(p);
  await p.keyboard.type("Going to the trash");
  await save(p);
  await p.getByTestId("note-settings").click();
  await p.getByTestId("note-trash").click();
  await p.locator(`[data-testid="note-row"][data-id="${id}"]`).waitFor({ state: "detached" });
  await p.getByTestId("nav-trash").click();
  const row = p.locator(`[data-testid="trash-row"][data-id="${id}"]`);
  await row.waitFor();
  await row.getByTestId("trash-restore").click();
  await row.waitFor({ state: "detached" });
  await p.getByTestId("nav-account").waitFor();
  await p.goto(`${s.url}/n/${id}`);
  await p.getByTestId("editor").waitFor();
  await p.waitForFunction(() => (window as unknown as { __notes?: unknown }).__notes !== undefined);
  assert.equal(bodyOf(await notesText(p)), "Going to the trash");
  // Into the trash again, and empty it: it asks first.
  await p.getByTestId("note-settings").click();
  await p.getByTestId("note-trash").click();
  await p.getByTestId("nav-trash").click();
  await p.locator(`[data-testid="trash-row"][data-id="${id}"]`).getByTestId("trash-empty-one").click();
  await p.getByTestId("cancel").click();
  await p.locator(`[data-testid="trash-row"][data-id="${id}"]`).waitFor();
  await p.getByTestId("trash-empty-all").click();
  await p.getByTestId("confirm").click();
  await p.locator(`[data-testid="trash-row"][data-id="${id}"]`).waitFor({ state: "detached" });
  assert.deepEqual(policyErrors(errors), []);
  await close();
});
