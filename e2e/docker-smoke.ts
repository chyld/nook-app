// Smoke check of the running Docker stack (brief: done means): log in as an account made with
// notes-admin, create a note, type and style in Rich, save, reload. Usage:
//   node e2e/docker-smoke.ts [https://localhost:9988] [username] [password]
import { chromium, type Page } from "playwright";

/** Puts the caret at the end of the note and gives the editor the focus, through the test
 *  contract (window.__notes) rather than CodeMirror's own class names (review, 45). */
async function clickEditor(p: Page): Promise<void> {
  await p.getByTestId("editor").waitFor();
  await p.evaluate(() => {
    const n = (window as unknown as { __notes: { text(): string; select(a: number): void } }).__notes;
    n.select(n.text().length);
  });
}
const URL = process.argv[2] ?? "https://localhost:9988";
const USER = process.argv[3] ?? "smoke";
const PASS = process.argv[4] ?? "docker smoke password";
let failed = false;
const b = await chromium.launch();
const ctx = await b.newContext({ ignoreHTTPSErrors: true });
const p = await ctx.newPage();
const errors: string[] = [];
p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
p.on("pageerror", (e) => errors.push(String(e)));
const text = () => p.evaluate(() => (window as any).__notes.text() as string);
try {
  await p.goto(`${URL}/`);
  await p.getByTestId("login-username").fill(USER);
  await p.getByTestId("login-password").fill(PASS);
  await p.getByTestId("login-submit").click();
  await p.getByTestId("new-note").click();
  await p.getByTestId("editor").waitFor();
  await p.waitForFunction(() => (window as any).__notes !== undefined);
  const id = /\/n\/([a-z2-7]{24})/.exec(p.url())![1];
  await clickEditor(p);
  await p.keyboard.type("Docker works");
  const t = await text();
  await p.evaluate(([a, z]) => (window as any).__notes.select(a, z), [t.indexOf("works"), t.indexOf("works") + 5]);
  await p.getByTestId("cmd-bold").click();
  console.log("mode", await p.getByTestId("editor").getAttribute("data-mode"));
  await p.getByTestId("save").click();
  await p.locator('[data-testid="save-status"][data-state="saved"]').waitFor();
  await p.reload();
  await p.waitForFunction(() => (window as any).__notes !== undefined);
  const after = await text();
  console.log("after reload", JSON.stringify(after));
  if (!after.endsWith("Docker **works**")) throw new Error("the saved text is not there after a reload");
  // 7.7: text typed in a table cell and saved with Save (the cell still focused) is saved.
  await clickEditor(p);
  await p.keyboard.press("Control+End");
  await p.getByTestId("cmd-insert").click();
  await p.locator('[data-testid="menu-item"][data-value="table"]').click();
  await p.locator('[data-testid="table-cell"][data-row="1"][data-col="0"]').click();
  await p.keyboard.type("hello");
  await p.getByTestId("save").click();
  await p.locator('[data-testid="save-status"][data-state="saved"]').waitFor();
  await p.reload();
  await p.waitForFunction(() => (window as any).__notes !== undefined);
  const cellText = await text();
  console.log("cell after reload", /\| hello \|/.test(cellText));
  if (!/\| hello \|/.test(cellText)) throw new Error("the cell's text was not saved");
  const r = await p.request.get(`${URL}/n/${id}`);
  console.log("csp", r.headers()["content-security-policy"]?.slice(0, 60), "hsts", r.headers()["strict-transport-security"]);
} catch (e) {
  failed = true;
  console.log("FAILED", e);
} finally {
  console.log("errors", errors);
  await b.close();
  process.exitCode = failed || errors.some((e) => /Refused to|Content Security/.test(e)) ? 1 : 0;
}
