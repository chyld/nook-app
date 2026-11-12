// SPEC2 4.1, rule 3 (version 1's fsutil.ts): no file is ever changed in place. Every file is written to a temporary
// file in a `tmp/` folder on the same disk, synced, and moved into place by rename, or by an
// exclusive link where an existing file must not be replaced. The folder is then synced.

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { sfs as fs } from "./safefs.ts";
import path from "node:path";
import { randomBase32 } from "../../contract/src/index.ts";

/** Test hook: called before every step of a multi-file operation (see server/test/). */
export const faults: { before?: (step: string) => void } = {};

/** Runs the fault hook for a named step; a test throws from it to stop an operation there. */
export function step(name: string): void {
  faults.before?.(name);
}

export async function fsyncDir(dir: string): Promise<void> {
  // O_NOFOLLOW: the folder itself may not be a symbolic link either.
  const fh = await fs.open(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
}

export interface NewFileOptions {
  /** Modification time to give the file before it is synced (a Date, or seconds since 1970). */
  mtime?: Date | number;
}

/** Writes `data` to a new temporary file in `tmpDir`, synced. Returns its path. */
export async function writeTemp(tmpDir: string, data: Uint8Array, opts: NewFileOptions = {}): Promise<string> {
  const file = path.join(tmpDir, `${Date.now()}-${randomBase32(10)}`);
  const fh = await fs.open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    await fh.writeFile(data);
    if (opts.mtime) await fh.utimes(opts.mtime, opts.mtime);
    await fh.sync();
  } catch (e) {
    await fh.close().catch(() => {});
    await fs.rm(file, { force: true });
    throw e;
  } finally {
    await fh.close().catch(() => {});
  }
  return file;
}

/** Replaces (or creates) `dest` with `data` by rename. */
export async function replaceFile(tmpDir: string, dest: string, data: Uint8Array, opts: NewFileOptions = {}): Promise<void> {
  const tmp = await writeTemp(tmpDir, data, opts);
  try {
    await fs.rename(tmp, dest);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
  await fsyncDir(path.dirname(dest));
}

/** Creates `dest` with `data`; fails with EEXIST if it exists. */
export async function createFile(tmpDir: string, dest: string, data: Uint8Array, opts: NewFileOptions = {}): Promise<void> {
  const tmp = await writeTemp(tmpDir, data, opts);
  try {
    await fs.link(tmp, dest);
  } finally {
    await fs.rm(tmp, { force: true });
  }
  await fsyncDir(path.dirname(dest));
}

/** Moves a file or folder between folders by rename and syncs both folders. */
export async function move(src: string, dest: string): Promise<void> {
  await fs.rename(src, dest);
  await fsyncDir(path.dirname(dest));
  if (path.dirname(src) !== path.dirname(dest)) await fsyncDir(path.dirname(src));
}

/** Moves a file to a name that must not exist yet: link, then remove the old name. */
export async function moveExclusive(src: string, dest: string): Promise<void> {
  await fs.link(src, dest);
  await fsyncDir(path.dirname(dest));
  await fs.rm(src);
  await fsyncDir(path.dirname(src));
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch (e) {
    if (isNotFound(e)) return false;
    throw e;
  }
}

/**
 * True when a path does not exist. A name too long for the filesystem (ENAMETOOLONG) cannot
 * exist either: the assets folder of a note with a long hand-placed name, say.
 */
export function isNotFound(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException)?.code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "ENAMETOOLONG";
}

export function errCode(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException)?.code;
}

/** Reads a file; null if it does not exist. Refuses a symbolic link (reads as missing). */
export async function readRegular(p: string): Promise<Buffer | null> {
  try {
    const fh = await fs.open(p, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const st = await fh.stat();
      if (!st.isFile()) return null;
      return await fh.readFile();
    } finally {
      await fh.close();
    }
  } catch (e) {
    if (isNotFound(e) || errCode(e) === "ELOOP") return null;
    throw e;
  }
}

/** mkdir -p with mode 0700, syncing the parent of each folder made. */
export async function ensureDir(dir: string): Promise<void> {
  const made = await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  if (made) await fsyncDir(path.dirname(dir));
}

/** Removes everything inside `dir` except the names in `keep`. */
export async function emptyDir(dir: string, keep: Set<string> = new Set()): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (e) {
    if (isNotFound(e)) return;
    throw e;
  }
  for (const n of names) if (!keep.has(n)) await fs.rm(path.join(dir, n), { recursive: true, force: true });
}

export function sha256hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** SPEC2 4.4: a note's revision is the SHA-256 of its bytes. */
export function revisionOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
