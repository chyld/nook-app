// The running server's state (SPEC2 4.1, 5, 13): settings, accounts, every user's space, and
// the backup pause.

import * as fsp from "node:fs/promises";
import path from "node:path";
import { HttpError } from "./errors.ts";
import { emptyDir, ensureDir, exists, fsyncDir } from "./fsutil.ts";
import { DataLayout } from "./layout.ts";
import { Locks, type Release } from "./lock.ts";
import type { Logger } from "./log.ts";
import { Accounts, type User } from "./accounts.ts";
import { Spaces } from "./space.ts";
import type { Config } from "./config.ts";
import { sfs as fs } from "./safefs.ts";

/** 13: the server ends a pause by itself after two minutes. */
export const PAUSE_MS = 2 * 60 * 1000;

export class Context {
  readonly config: Config;
  readonly layout: DataLayout;
  readonly locks = new Locks();
  readonly log: Logger;
  readonly accounts: Accounts;
  readonly spaces: Spaces;
  #pause: { releases: Release[]; timer: NodeJS.Timeout } | null = null;
  #pausing: Promise<void> | null = null;

  constructor(config: Config, log: Logger) {
    this.config = config;
    this.layout = new DataLayout(config.dataDir);
    this.log = log;
    this.accounts = new Accounts(this.layout, this.locks, log);
    this.spaces = new Spaces(this.layout, log);
  }

  /** Startup: folders, accounts, every `tmp/` emptied, ended sessions removed. */
  async start(): Promise<void> {
    // The data folder itself (outside it nothing is checked or synced).
    await fsp.mkdir(this.layout.root, { recursive: true, mode: 0o700 });
    await ensureDir(this.layout.users);
    await ensureDir(this.layout.removed);
    await ensureDir(this.layout.cache);
    await ensureDir(this.layout.previews);
    await ensureDir(this.layout.cacheTmp);
    await emptyDir(this.layout.cacheTmp);
    await this.accounts.load();
    for (const u of this.accounts.users) await this.spaces.run(u.id, (s) => s.start());
    await this.accounts.removeEndedSessions();
  }

  async addUser(username: string, password: string): Promise<User> {
    const user = await this.accounts.addUser(username, password);
    await this.spaces.run(user.id, (s) => s.start());
    return user;
  }

  /** remove-user (5): the user's lock, then the accounts lock; the folder goes to `removed/`. */
  async removeUser(username: string): Promise<string> {
    const user = this.accounts.byName(username);
    if (!user) throw new HttpError(404, "There is no such user.");
    return this.spaces.run(user.id, async (space) =>
      this.locks.accounts.run(async () => {
        await this.accounts.removeUserLocked(user.id);
        const date = new Date().toISOString().slice(0, 10);
        let dest = path.join(this.layout.removed, `${user.id}-${date}`);
        for (let n = 2; await exists(dest); n++) dest = path.join(this.layout.removed, `${user.id}-${date}-${n}`);
        if (await exists(space.layout.root)) {
          await fs.rename(space.layout.root, dest);
          await fsyncDir(this.layout.users);
          await fsyncDir(this.layout.removed);
        }
        this.spaces.forget(user.id);
        return path.basename(dest);
      }),
    );
  }

  // --- the backup pause (13) ---------------------------------------------------------------------

  get paused(): boolean {
    return this.#pause !== null;
  }

  /** Takes every user's lock in order of user id, then the accounts lock. Requests that need a
   *  lock wait for it; none is refused. */
  async pauseWrites(): Promise<void> {
    if (this.#pause || this.#pausing) throw new HttpError(409, "Writes are already paused.");
    const run = async () => {
      for (;;) {
        const releases: Release[] = [];
        const ids = this.accounts.users.map((u) => u.id).sort();
        try {
          for (const id of ids) releases.push(await this.spaces.get(id).lock.acquire());
          releases.push(await this.locks.accounts.acquire());
          const now = this.accounts.users.map((u) => u.id).sort();
          if (now.length !== ids.length || now.some((id, i) => id !== ids[i])) {
            for (const r of releases.reverse()) r();
            continue;
          }
        } catch (e) {
          for (const r of releases.reverse()) r();
          throw e;
        }
        const timer = setTimeout(() => this.#endPause(), PAUSE_MS);
        timer.unref();
        this.#pause = { releases, timer };
        return;
      }
    };
    this.#pausing = run();
    try {
      await this.#pausing;
    } finally {
      this.#pausing = null;
    }
  }

  #endPause(): boolean {
    const p = this.#pause;
    if (!p) return false;
    this.#pause = null;
    clearTimeout(p.timer);
    for (const r of p.releases.reverse()) r();
    return true;
  }

  /** Reports whether the pause was still in force. */
  resumeWrites(): boolean {
    return this.#endPause();
  }

  async backupDone(): Promise<string> {
    return this.locks.accounts.run(() => this.accounts.recordBackupLocked());
  }
}
