// SPEC2 section 5: accounts, sessions, login limits and password changes (version 1's
// accounts.ts, with version 2's error answers).
//
// users.json is written only by this process, under the accounts lock, and kept in memory.
// A session is a file config/sessions/<sha256 of token>.json, written by rule 3.

import { sfs as fs } from "./safefs.ts";
import { randomBytes } from "node:crypto";
import path from "node:path";
import argon2 from "argon2";
import { LIMITS, newUserId } from "../../contract/src/index.ts";
import { HttpError } from "./errors.ts";
import { ensureDir, isNotFound, readRegular, replaceFile, sha256hex, emptyDir } from "./fsutil.ts";
import type { DataLayout } from "./layout.ts";
import type { Locks } from "./lock.ts";
import type { Logger } from "./log.ts";

export interface User {
  id: string;
  username: string;
  hash: string;
  created: string;
}

interface SessionFile {
  userId: string;
  made: number;
  used: number;
}

export const SESSION_IDLE_MS = 30 * 24 * 3600 * 1000;
export const SESSION_MAX_MS = 90 * 24 * 3600 * 1000;
export const SESSION_TOUCH_MS = 3600 * 1000;
export const MIN_PASSWORD = LIMITS.passwordMin;
export const MAX_PASSWORD = LIMITS.passwordMax;
export const MAX_USERNAME = LIMITS.usernameMax;

export const FAIL_WINDOW_MS = 15 * 60 * 1000;
export const FAIL_LIMIT = 5;
export const FAIL_TABLE_MAX = 10_000;
export const HASH_RUNNING = 2;
export const HASH_WAITING = 10;

/** DESIGN 13: an IPv6 address counts as its /64 network. */
export function clientKey(address: string): string {
  let a = address.toLowerCase();
  if (a.startsWith("::ffff:") && a.includes(".")) return a.slice(7);
  if (!a.includes(":")) return a;
  const zone = a.indexOf("%");
  if (zone >= 0) a = a.slice(0, zone);
  // Expand "::" to get the first four groups.
  const [head, tail = ""] = a.split("::");
  const h = head ? head.split(":") : [];
  const t = a.includes("::") ? (tail ? tail.split(":") : []) : [];
  const groups = a.includes("::") ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

/** Failed logins per pair of username and client address (DESIGN 13), bounded. */
export class FailureTable {
  #map = new Map<string, number[]>();
  /** Checks under way per pair: each may become a failure, so each counts against the limit. */
  #pending = new Map<string, number>();
  now: () => number = Date.now;

  #key(username: string, address: string): string {
    return `${username.toLowerCase()}\u0000${clientKey(address)}`;
  }

  #fresh(key: string): number[] {
    const t = this.now();
    const list = (this.#map.get(key) ?? []).filter((x) => t - x < FAIL_WINDOW_MS);
    if (list.length === 0) this.#map.delete(key);
    else this.#map.set(key, list);
    return list;
  }

  blocked(username: string, address: string): boolean {
    const key = this.#key(username, address);
    return this.#fresh(key).length + (this.#pending.get(key) ?? 0) >= FAIL_LIMIT;
  }

  /**
   * Starts a password check for a pair, or refuses it (false) when the failures so far and the
   * checks already under way reach the limit; a burst of guesses at once cannot go past it.
   * Every `begin` that answers true is followed by one `end`.
   */
  begin(username: string, address: string): boolean {
    if (this.blocked(username, address)) return false;
    const key = this.#key(username, address);
    this.#pending.set(key, (this.#pending.get(key) ?? 0) + 1);
    return true;
  }

  end(username: string, address: string): void {
    const key = this.#key(username, address);
    const n = (this.#pending.get(key) ?? 1) - 1;
    if (n > 0) this.#pending.set(key, n);
    else this.#pending.delete(key);
  }

  fail(username: string, address: string): void {
    const key = this.#key(username, address);
    const list = this.#fresh(key);
    list.push(this.now());
    this.#map.delete(key);
    this.#map.set(key, list);
    this.sweep();
    // The oldest entry is dropped when the table is full.
    while (this.#map.size > FAIL_TABLE_MAX) this.#map.delete(this.#map.keys().next().value!);
  }

  clear(username: string, address: string): void {
    this.#map.delete(this.#key(username, address));
  }

  /** Removes entries whose failures are all older than 15 minutes. */
  sweep(): void {
    const t = this.now();
    for (const [k, list] of this.#map) {
      if (list.every((x) => t - x >= FAIL_WINDOW_MS)) this.#map.delete(k);
    }
  }

  get size(): number {
    return this.#map.size;
  }
}

/** At most two password hashes run at once and at most ten wait; beyond that, 429. */
export class HashGate {
  #running = 0;
  #waiting: (() => void)[] = [];

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#running >= HASH_RUNNING) {
      if (this.#waiting.length >= HASH_WAITING) throw new HttpError(429, "Too many login attempts at once. Try again in a moment.");
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    } else {
      this.#running++;
    }
    try {
      return await fn();
    } finally {
      const next = this.#waiting.shift();
      if (next) next();
      else this.#running--;
    }
  }
}

export interface SessionResult {
  user: User;
  tokenHash: string;
  /** Set when the last-used time was written: the cookie is sent again with this lifetime. */
  refreshMaxAge?: number;
}

export class Accounts {
  readonly layout: DataLayout;
  readonly locks: Locks;
  readonly log: Logger;
  users: User[] = [];
  readonly failures = new FailureTable();
  readonly gate = new HashGate();
  #dummyHash = "";
  now: () => number = Date.now;

  constructor(layout: DataLayout, locks: Locks, log: Logger) {
    this.layout = layout;
    this.locks = locks;
    this.log = log;
  }

  async load(): Promise<void> {
    await ensureDir(this.layout.config);
    await ensureDir(this.layout.sessions);
    await ensureDir(this.layout.configTmp);
    await emptyDir(this.layout.configTmp);
    const bytes = await readRegular(this.layout.usersFile);
    this.users = bytes ? (JSON.parse(bytes.toString("utf8")).users as User[]) : [];
    this.#dummyHash = await argon2.hash(randomBytes(32).toString("hex"), { type: argon2.argon2id });
  }

  /** Writes the list to users.json, and only then keeps it in memory (rule 3; DESIGN 12). */
  async #saveUsers(users: User[]): Promise<void> {
    await replaceFile(this.layout.configTmp, this.layout.usersFile, Buffer.from(JSON.stringify({ users }, null, 2)));
    this.users = users;
  }

  byName(username: string): User | undefined {
    const key = username.toLowerCase();
    return this.users.find((u) => u.username.toLowerCase() === key);
  }

  byId(id: string): User | undefined {
    return this.users.find((u) => u.id === id);
  }

  static usernameProblem(username: unknown): string | null {
    if (typeof username !== "string" || username.trim() === "") return "A username is needed.";
    if (username !== username.trim()) return "A username may not begin or end with a space.";
    if ([...username].length > MAX_USERNAME) return `A username may be at most ${MAX_USERNAME} characters.`;
    if (/[\u0000-\u001f\u007f-\u009f]/.test(username)) return "A username may not contain control characters.";
    return null;
  }

  static passwordProblem(password: unknown): string | null {
    if (typeof password !== "string") return "A password is needed.";
    if ([...password].length < MIN_PASSWORD) return `A password must have at least ${MIN_PASSWORD} characters.`;
    if ([...password].length > MAX_PASSWORD) return `A password may be at most ${MAX_PASSWORD} characters.`;
    return null;
  }

  static hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  // -------------------------------------------------------------------------------------------
  // Admin commands (DESIGN 12)

  async addUser(username: string, password: string): Promise<User> {
    const up = Accounts.usernameProblem(username);
    if (up) throw new HttpError(422, up);
    const pp = Accounts.passwordProblem(password);
    if (pp) throw new HttpError(422, pp);
    const hash = await Accounts.hash(password);
    return this.locks.accounts.run(async () => {
      if (this.byName(username)) throw new HttpError(409, "A user with this name exists.");
      let id = newUserId();
      while (this.byId(id)) id = newUserId();
      const user: User = { id, username, hash, created: new Date(this.now()).toISOString() };
      await this.#saveUsers([...this.users, user]);
      return user;
    });
  }

  /** Sets a password and deletes all of the user's sessions. */
  async resetPassword(username: string, password: string): Promise<void> {
    const pp = Accounts.passwordProblem(password);
    if (pp) throw new HttpError(422, pp);
    const hash = await Accounts.hash(password);
    await this.locks.accounts.run(async () => {
      const u = this.byName(username);
      if (!u) throw new HttpError(404, "There is no such user.");
      // Sessions first: a crash between the two leaves the old password and no sessions, never
      // the new password with the old sessions.
      await this.#deleteSessions(u.id);
      await this.#saveUsers(this.users.map((x) => (x.id === u.id ? { ...x, hash } : x)));
    });
  }

  /** Under the accounts lock (the caller holds the user's lock first). */
  async removeUserLocked(userId: string): Promise<void> {
    await this.#deleteSessions(userId);
    await this.#saveUsers(this.users.filter((u) => u.id !== userId));
  }

  async #deleteSessions(userId: string, except?: string): Promise<void> {
    for (const f of await fs.readdir(this.layout.sessions)) {
      if (!f.endsWith(".json") || f === except) continue;
      const s = await this.#readSession(f);
      if (s && s.userId === userId) await fs.rm(path.join(this.layout.sessions, f), { force: true });
    }
  }

  async #readSession(file: string): Promise<SessionFile | null> {
    const bytes = await readRegular(path.join(this.layout.sessions, file));
    if (!bytes) return null;
    try {
      return JSON.parse(bytes.toString("utf8")) as SessionFile;
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Login, sessions, logout

  /** Checks a password against a user's hash, or the dummy hash for an unknown user. */
  async #verify(user: User | undefined, password: string): Promise<boolean> {
    return this.verifyHash(user ? user.hash : this.#dummyHash, password);
  }

  /** Checks a password against one hash string (through the hashing gate). */
  async verifyHash(hash: string, password: string): Promise<boolean> {
    return this.gate.run(async () => {
      try {
        return await argon2.verify(hash, password);
      } catch {
        return false;
      }
    });
  }

  async login(username: unknown, password: unknown, address: string): Promise<{ token: string; user: User }> {
    if (typeof username !== "string" || typeof password !== "string" || [...username].length > MAX_USERNAME || [...password].length > MAX_PASSWORD) {
      throw new HttpError(400, "Username and password are needed.");
    }
    if (!this.failures.begin(username, address)) {
      throw new HttpError(429, "Too many failed logins. Wait 15 minutes and try again.");
    }
    const user = this.byName(username);
    let ok: boolean;
    try {
      ok = await this.#verify(user, password);
    } finally {
      this.failures.end(username, address);
    }
    if (!ok || !user) {
      this.failures.fail(username, address);
      throw new HttpError(401, "The username or password is wrong.", {}, "wrong-login");
    }
    this.failures.clear(username, address);
    const checkedHash = user.hash;
    return this.locks.accounts.run(async () => {
      // A password change at the same moment: the stored hash must still be the one checked.
      const now = this.byId(user.id);
      if (!now || now.hash !== checkedHash) throw new HttpError(401, "The username or password is wrong.", {}, "wrong-login");
      const token = randomBytes(32).toString("base64url");
      const t = this.now();
      await this.#writeSession(sha256hex(token), { userId: user.id, made: t, used: t });
      return { token, user: now };
    });
  }

  async #writeSession(tokenHash: string, s: SessionFile): Promise<void> {
    await replaceFile(this.layout.configTmp, path.join(this.layout.sessions, `${tokenHash}.json`), Buffer.from(JSON.stringify(s)));
  }

  /** The session check of DESIGN 12; null if the session does not exist, ended, or has no user. */
  async session(token: string | undefined): Promise<SessionResult | null> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const tokenHash = sha256hex(token);
    return this.locks.accounts.run(async () => {
      const s = await this.#readSession(`${tokenHash}.json`);
      if (!s) return null;
      const t = this.now();
      if (t - s.used >= SESSION_IDLE_MS || t - s.made >= SESSION_MAX_MS) {
        await fs.rm(path.join(this.layout.sessions, `${tokenHash}.json`), { force: true });
        return null;
      }
      const user = this.byId(s.userId);
      if (!user) return null;
      const result: SessionResult = { user, tokenHash };
      if (t - s.used >= SESSION_TOUCH_MS) {
        await this.#writeSession(tokenHash, { ...s, used: t });
        result.refreshMaxAge = Math.floor(Math.min(SESSION_IDLE_MS, s.made + SESSION_MAX_MS - t) / 1000);
      }
      return result;
    });
  }

  /** The cookie lifetime of a new session, in seconds. */
  static newMaxAge(): number {
    return Math.floor(SESSION_IDLE_MS / 1000);
  }

  async logout(tokenHash: string): Promise<void> {
    await this.locks.accounts.run(() => fs.rm(path.join(this.layout.sessions, `${tokenHash}.json`), { force: true }));
  }

  /** Change my password: needs the current one, counted by the login limit, ends other sessions. */
  async changePassword(user: User, tokenHash: string, current: unknown, next: unknown, address: string): Promise<void> {
    if (typeof current !== "string" || typeof next !== "string" || [...current].length > MAX_PASSWORD) {
      throw new HttpError(400, "The current and the new password are needed.");
    }
    // The hash string that is checked is the one required under the lock (as login does), so a
    // reset that lands during the check is never overwritten.
    const checkedHash = this.byId(user.id)?.hash;
    if (checkedHash === undefined) throw new HttpError(401, "Please log in.");
    if (!this.failures.begin(user.username, address)) {
      throw new HttpError(429, "Too many failed attempts. Wait 15 minutes and try again.");
    }
    let ok: boolean;
    try {
      ok = await this.verifyHash(checkedHash, current);
    } finally {
      this.failures.end(user.username, address);
    }
    if (!ok) {
      this.failures.fail(user.username, address);
      throw new HttpError(422, "The current password is wrong.", {}, "wrong-password");
    }
    const pp = Accounts.passwordProblem(next);
    if (pp) throw new HttpError(422, pp, {}, "weak-password");
    const hash = await this.gate.run(() => Accounts.hash(next));
    await this.locks.accounts.run(async () => {
      const u = this.byId(user.id);
      if (!u || u.hash !== checkedHash) throw new HttpError(409, "The password was changed at the same moment. Try again.");
      // The other sessions first, as in resetPassword.
      await this.#deleteSessions(u.id, `${tokenHash}.json`);
      await this.#saveUsers(this.users.map((x) => (x.id === u.id ? { ...x, hash } : x)));
    });
  }

  /** Removes ended sessions (at startup and once a day). */
  async removeEndedSessions(): Promise<number> {
    let removed = 0;
    await this.locks.accounts.run(async () => {
      const t = this.now();
      for (const f of await fs.readdir(this.layout.sessions).catch((e) => (isNotFound(e) ? [] : Promise.reject(e)))) {
        if (!f.endsWith(".json")) continue;
        const s = await this.#readSession(f);
        if (!s || t - s.used >= SESSION_IDLE_MS || t - s.made >= SESSION_MAX_MS || !this.byId(s.userId)) {
          await fs.rm(path.join(this.layout.sessions, f), { force: true });
          removed++;
        }
      }
    });
    return removed;
  }

  // -------------------------------------------------------------------------------------------
  // Backup time (DESIGN 15)

  async lastBackup(): Promise<string | null> {
    const bytes = await readRegular(this.layout.backupFile);
    if (!bytes) return null;
    try {
      return JSON.parse(bytes.toString("utf8")).last ?? null;
    } catch {
      return null;
    }
  }

  /** Under the accounts lock. */
  async recordBackupLocked(): Promise<string> {
    const last = new Date(this.now()).toISOString();
    await replaceFile(this.layout.configTmp, this.layout.backupFile, Buffer.from(JSON.stringify({ last })));
    return last;
  }
}
