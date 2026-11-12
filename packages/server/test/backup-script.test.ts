// Finding 35 of the version 2 code review: scripts/backup.sh, run by sh with stand-ins for
// notes-admin and restic on PATH, on a temporary data folder.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../../scripts/backup.sh", import.meta.url));

/** A data folder, a log, and stand-ins: `restic backup` lists the copy's tmp folders; the first
 *  `notes-admin resume-writes` can be made to stop the script with SIGTERM as it starts. */
async function setup(o: { termOnFirstResume?: boolean } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "notes-backup-test-"));
  const data = path.join(dir, "srv");
  const bin = path.join(dir, "bin");
  const log = path.join(dir, "log");
  for (const p of ["config/sessions", "config/tmp", "users/u1/tmp", "users/u1/notes", "removed/u2-2026-11-12/tmp", "removed/u2-2026-11-12/notes"]) await fs.mkdir(path.join(data, p), { recursive: true });
  for (const p of ["users/u1/tmp/junk", "removed/u2-2026-11-12/tmp/junk", "users/u1/notes/n", "config/users.json"]) await fs.writeFile(path.join(data, p), "x");
  await fs.mkdir(bin);
  await fs.writeFile(
    path.join(bin, "notes-admin"),
    `#!/bin/sh
echo "notes-admin $*" >> "${log}"
if [ "$1" = resume-writes ] && [ "${o.termOnFirstResume ? 1 : 0}" = 1 ] && [ ! -e "${dir}/termed" ]; then
  touch "${dir}/termed"; kill -TERM $PPID; exit 1
fi
exit 0
`,
    { mode: 0o755 },
  );
  await fs.writeFile(
    path.join(bin, "restic"),
    `#!/bin/sh
case "$1" in
  backup) find . -name tmp -type d | sed 's/^/copied: /' >> "${log}" ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  const run = () => spawnSync("sh", [SCRIPT], { env: { PATH: `${bin}:/usr/bin:/bin`, NOTES_DATA: data, RESTIC_REPOSITORY: "/x", RESTIC_PASSWORD: "x" }, encoding: "utf8" });
  return { run, log: async () => (await fs.readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean), done: () => fs.rm(dir, { recursive: true, force: true }) };
}

test("35: the copy holds no tmp/ folder, a removed user's included", async () => {
  const s = await setup();
  const r = s.run();
  assert.equal(r.status, 0, r.stderr);
  const lines = await s.log();
  assert.deepEqual(lines.filter((l) => l.startsWith("copied:")), [], lines.join("\n"));
  assert.ok(lines.includes("notes-admin backup-done"));
  await s.done();
});

test("35: a signal at the moment writes are resumed still leaves writes resumed", async () => {
  const s = await setup({ termOnFirstResume: true });
  s.run();
  const lines = await s.log();
  const resumes = lines.filter((l) => l === "notes-admin resume-writes").length;
  assert.ok(resumes >= 2, `resume-writes was asked ${resumes} time(s): the stopped script did not resume writes\n${lines.join("\n")}`);
  await s.done();
});
