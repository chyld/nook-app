// SPEC2 5: sessions (30 days after last use, 90 after made, last use written at most hourly with
// the cookie sent again), ended sessions removed, the admin command over its socket.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { startAdminSocket } from "../src/admin.ts";
import { Client, PASSWORD, startServer, tempDir } from "./http.ts";

const run = promisify(execFile);
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

test("sessions end 30 days after last use or 90 days after they were made", async () => {
  const s = await startServer();
  await s.ctx.addUser("alice", PASSWORD);
  let now = Date.now();
  s.ctx.accounts.now = () => now;
  const c = new Client(s.app);
  await c.login("alice");
  now += 30 * 60 * 1000;
  let r = await c.get("/api/me");
  assert.equal(r.statusCode, 200);
  assert.equal(r.cookies.length, 0, "last use is written at most once an hour");
  now += 2 * HOUR;
  r = await c.get("/api/me");
  assert.equal(r.cookies.find((x) => x.name === "notes_session")?.maxAge, 30 * 24 * 3600, "the cookie is sent again with a fresh lifetime");
  // Used every 20 days: still ends at 90 days after it was made.
  for (let i = 0; i < 4; i++) {
    now += 20 * DAY;
    assert.equal((await c.get("/api/me")).statusCode, 200, `day ${(i + 1) * 20}`);
  }
  now += 11 * DAY;
  assert.equal((await c.get("/api/me")).statusCode, 401, "90 days after it was made");
  const d = new Client(s.app);
  await d.login("alice");
  now += 30 * DAY + 1;
  assert.equal((await d.get("/api/me")).statusCode, 401, "30 days after its last use");
  assert.equal(await s.ctx.accounts.removeEndedSessions(), 0, "already removed when found ended");
  const e = new Client(s.app);
  await e.login("alice");
  now += 31 * DAY;
  assert.equal(await s.ctx.accounts.removeEndedSessions(), 1);
  assert.deepEqual(await fs.readdir(path.join(s.root, "config", "sessions")), []);
});

test("notes-admin over the socket: add, list, new-id, reset (ends sessions), remove, pause", async () => {
  const s = await startServer();
  const sock = path.join(await tempDir(), "run", "admin.sock");
  const server = await startAdminSocket(s.ctx, sock);
  const cli = fileURLToPath(new URL("../src/admin-cli.ts", import.meta.url));
  const admin = async (args: string[], input?: string) => {
    const p = run(process.execPath, [cli, ...args], { env: { ...process.env, NOTES_ADMIN_SOCKET: sock } });
    if (input !== undefined) {
      p.child.stdin!.end(input);
    }
    try {
      const r = await p;
      return { code: 0, out: r.stdout, err: r.stderr };
    } catch (e) {
      const x = e as { code: number; stdout: string; stderr: string };
      return { code: x.code, out: x.stdout, err: x.stderr };
    }
  };
  const st = await fs.stat(sock);
  assert.equal(st.mode & 0o777, 0o600);
  assert.equal((await fs.stat(path.dirname(sock))).mode & 0o777, 0o700);
  assert.equal((await admin(["add-user", "carol"], `${PASSWORD}\n`)).code, 0);
  assert.notEqual((await admin(["add-user", "dave"], "short\n")).code, 0, "at least 12 characters");
  assert.match((await admin(["list-users"])).out, /^carol\t[a-z2-7]{16}\t/);
  assert.match((await admin(["new-id"])).out.trim(), /^[a-z2-7]{24}$/);
  const c = new Client(s.app);
  assert.equal((await c.login("carol")).statusCode, 200);
  assert.equal((await admin(["reset-password", "carol"], "another long password\n")).code, 0);
  assert.equal((await c.get("/api/me")).statusCode, 401, "reset-password deletes that user's sessions");
  assert.equal((await admin(["pause-writes"])).code, 0);
  assert.equal((await admin(["resume-writes"])).code, 0);
  assert.equal((await admin(["resume-writes"])).code, 3, "the pause was not in force");
  assert.equal((await admin(["backup-done"])).code, 0);
  assert.equal((await admin(["remove-user", "carol"])).code, 0);
  assert.equal((await admin(["list-users"])).out, "");
  server.close();
});
