// The e2e harness (SPEC2 12): the real server on a temporary folder, with the built bundle and
// the real content security policy; users made with notes-admin over its socket; Chromium
// through Playwright. Tests find things by test id only, and drive the core by window.__notes.

import { spawn, execFile, type ChildProcess } from "node:child_process";
import * as fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const run = promisify(execFile);

export const PASSWORD = "correct horse battery";

export interface Server {
  url: string;
  data: string;
  socket: string;
  proc: ChildProcess;
  stop(): Promise<void>;
  addUser(name: string, password?: string): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

export async function startServer(): Promise<Server> {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "notes-e2e-"));
  const socket = path.join(data, "run", "admin.sock");
  const port = await freePort();
  const env = { ...process.env, NOTES_DATA: path.join(data, "srv"), NOTES_PORT: String(port), NOTES_HOST: "127.0.0.1", NOTES_ADMIN_SOCKET: socket };
  const proc = spawn(process.execPath, [path.join(root, "packages/server/src/main.ts")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  proc.stdout!.on("data", (d) => (out += d));
  proc.stderr!.on("data", (d) => (out += d));
  for (let i = 0; i < 100 && !out.includes("listening"); i++) await new Promise((r) => setTimeout(r, 100));
  if (!out.includes("listening")) throw new Error(`the server did not start: ${out}`);
  const cli = path.join(root, "packages/server/src/admin-cli.ts");
  return {
    url: `http://localhost:${port}`,
    data,
    socket,
    proc,
    async stop() {
      proc.kill("SIGTERM");
      await new Promise((r) => proc.once("exit", r));
      await fs.rm(data, { recursive: true, force: true });
    },
    async addUser(name: string, password = PASSWORD) {
      const p = run(process.execPath, [cli, "add-user", name], { env: { ...process.env, NOTES_ADMIN_SOCKET: socket } });
      p.child.stdin!.end(`${password}\n`);
      await p;
    },
  };
}

export async function browser(): Promise<Browser> {
  return chromium.launch({ headless: true });
}

/** A page that records console errors and policy violations. */
export async function page(ctx: BrowserContext): Promise<{ page: Page; errors: string[] }> {
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  p.on("pageerror", (e) => errors.push(String(e)));
  return { page: p, errors };
}

export async function login(p: Page, url: string, name: string, password = PASSWORD): Promise<void> {
  await p.goto(`${url}/login`);
  await p.getByTestId("login-username").fill(name);
  await p.getByTestId("login-password").fill(password);
  await p.getByTestId("login-submit").click();
  await p.getByTestId("sidebar").waitFor();
}

/** Makes a note with the sidebar's New note and waits for its editor. */
export async function newNote(p: Page): Promise<string> {
  await p.getByTestId("new-note").click();
  await p.getByTestId("editor").waitFor();
  await p.waitForFunction(() => (window as unknown as { __notes?: unknown }).__notes !== undefined);
  return /\/n\/([a-z2-7]{24})/.exec(p.url())![1];
}

export const notesText = (p: Page) => p.evaluate(() => (window as unknown as { __notes: { text(): string } }).__notes.text());

/** Puts the caret at the end of the note and gives the editor the focus, through the test
 *  contract (window.__notes) rather than CodeMirror's own class names (review, 45). */
export async function clickEditor(p: Page): Promise<void> {
  await p.getByTestId("editor").waitFor();
  await p.evaluate(() => {
    const n = (window as unknown as { __notes: { text(): string; select(a: number): void } }).__notes;
    n.select(n.text().length);
  });
}
