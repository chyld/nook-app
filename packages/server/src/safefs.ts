// DESIGN 12, "keeping people apart": every path the server reads or writes must resolve inside
// the expected folder, and symbolic links are refused. O_NOFOLLOW protects only the last part of
// a path, so every file operation of the server goes through `sfs`, which first checks every
// part of the path below the data folder with lstat and refuses a symbolic link anywhere.
//
// The last part is checked too for the operations that would follow it (readdir, stat,
// readFile, writeFile, mkdir, rmdir, utimes). Operations that act on a link itself (lstat, rm,
// rename, link, open with O_NOFOLLOW) check only the folders above it.
//
// Tests can inject an error into any operation through `fsFaults.inject`.

import * as fs from "node:fs/promises";
import path from "node:path";

export class LinkRefused extends Error {
  override name = "LinkRefused";
}

const roots = new Set<string>();

/** Registers a data folder (DataLayout does this); paths below it are checked. */
export function registerRoot(root: string): void {
  roots.add(path.resolve(root));
}

function rootOf(abs: string): string | null {
  let best: string | null = null;
  for (const r of roots) {
    if ((abs === r || abs.startsWith(r + path.sep)) && (!best || r.length > best.length)) best = r;
  }
  return best;
}

/** Test hook: called with the operation and path before every call; may throw. */
export const fsFaults: { inject?: (op: string, p: string) => void } = {};

/**
 * Refuses a path that leaves every data folder, or that has a symbolic link in any part below
 * its data folder (the last part too when `last`). A missing part ends the check: nothing
 * below it exists.
 */
export async function guard(p: string, last: boolean): Promise<void> {
  const abs = path.resolve(p);
  const root = rootOf(abs);
  if (root === null) throw new LinkRefused("path outside the data folder");
  const rel = path.relative(root, abs);
  const parts = rel === "" ? [] : rel.split(path.sep);
  if (parts.includes("..")) throw new LinkRefused("path leaves the data folder");
  const n = last ? parts.length : parts.length - 1;
  let cur = root;
  for (let i = 0; i < n; i++) {
    cur = path.join(cur, parts[i]);
    let st;
    try {
      st = await fs.lstat(cur);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR" || code === "ENAMETOOLONG") return;
      throw e;
    }
    if (st.isSymbolicLink()) throw new LinkRefused("a symbolic link in the path is refused");
    if (i < parts.length - 1 && !st.isDirectory()) return; // the call itself fails with ENOTDIR
  }
}

async function g(op: string, p: string, last: boolean): Promise<void> {
  fsFaults.inject?.(op, p);
  await guard(p, last);
}

type P = string;

/** The node:fs/promises calls the server uses, each checked by `guard` first. */
export const sfs = {
  async readdir(p: P): Promise<string[]> {
    await g("readdir", p, true);
    return fs.readdir(p);
  },
  async readdirTypes(p: P) {
    await g("readdir", p, true);
    return fs.readdir(p, { withFileTypes: true });
  },
  async lstat(p: P) {
    await g("lstat", p, false);
    return fs.lstat(p);
  },
  async lstatBig(p: P) {
    await g("lstat", p, false);
    return fs.lstat(p, { bigint: true });
  },
  async stat(p: P) {
    await g("stat", p, true);
    return fs.stat(p);
  },
  async open(p: P, flags: number, mode?: number) {
    await g("open", p, false);
    return fs.open(p, flags, mode);
  },
  async rm(p: P, opts?: { recursive?: boolean; force?: boolean }) {
    await g("rm", p, false);
    return fs.rm(p, opts);
  },
  async rmdir(p: P) {
    await g("rmdir", p, true);
    return fs.rmdir(p);
  },
  async rename(a: P, b: P) {
    await g("rename", a, false);
    await g("rename", b, false);
    return fs.rename(a, b);
  },
  async link(a: P, b: P) {
    await g("link", a, false);
    await g("link", b, false);
    return fs.link(a, b);
  },
  async mkdir(p: P, opts: { recursive?: boolean; mode?: number }) {
    await g("mkdir", p, true);
    return fs.mkdir(p, opts);
  },
  async writeFile(p: P, data: Uint8Array | string, opts?: { mode?: number }) {
    await g("writeFile", p, true);
    return fs.writeFile(p, data, { ...opts, flag: "wx" });
  },
  async readFile(p: P) {
    await g("readFile", p, true);
    return fs.readFile(p);
  },
};

/** lstat that answers null only when the path does not exist; any other error is thrown. */
export async function lstatOrNull(p: P) {
  try {
    return await sfs.lstat(p);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    // A name too long for the filesystem cannot exist: absent too.
    if (code === "ENOENT" || code === "ENOTDIR" || code === "ENAMETOOLONG") return null;
    throw e;
  }
}

/** readdir that answers [] only when the folder does not exist. */
export async function readdirOrEmpty(p: P): Promise<string[]> {
  try {
    return await sfs.readdir(p);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "ENAMETOOLONG") return [];
    throw e;
  }
}
