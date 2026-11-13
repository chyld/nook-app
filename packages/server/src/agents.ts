// SPEC-AGENTS 2 and 3.3: agents' tokens and the limits on what agents write.
//
// agents.json is written only by this process, under the accounts lock, and kept in memory (as
// users.json is). It holds each token's SHA-256, never the token. A token is good only while its
// user exists.

import { createHash } from "node:crypto";
import { LIMITS, MB, newAgentId, newAgentToken, RE, type Agent } from "../../contract/src/index.ts";
import type { User } from "./accounts.ts";
import { HttpError } from "./errors.ts";
import { readRegular, replaceFile } from "./fsutil.ts";
import type { DataLayout } from "./layout.ts";
import type { Locks } from "./lock.ts";
import type { Logger } from "./log.ts";

export interface AgentRecord {
  id: string;
  userId: string;
  name: string;
  /** SHA-256 of the token, in hex. */
  hash: string;
  /** ISO date-times; `used` is written at most once an hour. */
  created: string;
  used: string | null;
}

/** How often a token's last use is written. */
export const AGENT_TOUCH_MS = 3600 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 3600 * 1000;

const sha256hex = (s: string): string => createHash("sha256").update(s).digest("hex");

const isRecord = (v: unknown): v is AgentRecord => {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.userId === "string" && typeof r.name === "string" && typeof r.hash === "string" && typeof r.created === "string" && (r.used === null || typeof r.used === "string");
};

const publicOf = (r: AgentRecord): Agent => ({ id: r.id, name: r.name, created: r.created, used: r.used });

/** The token of an `Authorization` header (`Bearer nook_…`), or null. */
export function bearerToken(header: unknown): string | null {
  if (typeof header !== "string") return null;
  const m = /^Bearer +(\S+)$/i.exec(header.trim());
  return m && RE.agentToken.test(m[1]) ? m[1] : null;
}

/** An agent's name as it is kept: trimmed; null when it is not 1 to 40 characters without
 *  control characters (2.1). */
export function cleanAgentName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const t = name.trim();
  return [...t].length >= 1 && [...t].length <= LIMITS.agentName && !/[\u0000-\u001f\u007f-\u009f]/u.test(t) ? t : null;
}

export class Agents {
  readonly layout: DataLayout;
  readonly locks: Locks;
  readonly log: Logger;
  readonly userById: (id: string) => User | undefined;
  records: AgentRecord[] = [];
  #byHash = new Map<string, AgentRecord>();
  /** Per person (3.3): the times of the changing requests of the last minute, and the times and
   *  bytes of those of the last 24 hours. In memory: a restart clears them. */
  #changes = new Map<string, number[]>();
  #bytes = new Map<string, { at: number; bytes: number }[]>();
  now: () => number = Date.now;

  constructor(layout: DataLayout, locks: Locks, log: Logger, userById: (id: string) => User | undefined) {
    this.layout = layout;
    this.locks = locks;
    this.log = log;
    this.userById = userById;
  }

  /** Startup, after the accounts are loaded. A file that cannot be read as a list of records is
   *  an empty table: no token works until a person makes one. */
  async load(): Promise<void> {
    const bytes = await readRegular(this.layout.agentsFile);
    let records: AgentRecord[] = [];
    if (bytes) {
      try {
        const v = JSON.parse(bytes.toString("utf8")) as { agents?: unknown };
        if (Array.isArray(v.agents)) records = v.agents.filter(isRecord);
        else this.log.error("agents.json is not a list of tokens; no token works until one is made");
      } catch {
        this.log.error("agents.json is not JSON; no token works until one is made");
      }
    }
    this.#keep(records);
  }

  #keep(records: AgentRecord[]): void {
    this.records = records;
    this.#byHash = new Map(records.map((r) => [r.hash, r]));
  }

  /** Writes the table, and only then keeps it in memory (rule 3). The accounts lock is held. */
  async #save(records: AgentRecord[]): Promise<void> {
    await replaceFile(this.layout.configTmp, this.layout.agentsFile, Buffer.from(JSON.stringify({ agents: records }, null, 2)));
    this.#keep(records);
  }

  list(userId: string): Agent[] {
    return this.records.filter((r) => r.userId === userId).map(publicOf);
  }

  /** 2.2: a new token for a person. The token is in the answer once and is never kept. */
  async make(userId: string, name: unknown): Promise<{ agent: Agent; token: string }> {
    const clean = cleanAgentName(name);
    if (clean === null) throw new HttpError(400, `An agent's name is 1 to ${LIMITS.agentName} characters, without control characters.`, {}, "bad-name");
    return this.locks.accounts.run(async () => {
      if (!this.userById(userId)) throw new HttpError(401, "Please log in.");
      const mine = this.records.filter((r) => r.userId === userId);
      if (mine.some((r) => r.name.toLowerCase() === clean.toLowerCase())) throw new HttpError(409, "You already have an agent with this name.", {}, "name-taken");
      if (mine.length >= LIMITS.agents) throw new HttpError(409, `You may have at most ${LIMITS.agents} agents. Revoke one first.`, {}, "limit");
      let id = newAgentId();
      while (this.records.some((r) => r.id === id)) id = newAgentId();
      const token = newAgentToken();
      const record: AgentRecord = { id, userId, name: clean, hash: sha256hex(token), created: new Date(this.now()).toISOString(), used: null };
      await this.#save([...this.records, record]);
      return { agent: publicOf(record), token };
    });
  }

  /** 2.2: revoke one of a person's tokens; 404 for another person's or none. */
  async revoke(userId: string, id: string): Promise<void> {
    await this.locks.accounts.run(async () => {
      if (!this.records.some((r) => r.id === id && r.userId === userId)) throw new HttpError(404, "There is no such agent.");
      await this.#save(this.records.filter((r) => r.id !== id));
    });
  }

  /** 2.1: all of a user's tokens go, when the user is removed or the password changes. The
   *  caller holds the accounts lock (it cannot be taken twice) and calls this before it writes
   *  users.json. */
  async removeForUserLocked(userId: string): Promise<void> {
    if (!this.records.some((r) => r.userId === userId)) return;
    await this.#save(this.records.filter((r) => r.userId !== userId));
  }

  /** 3.1: the user and the record of a token, or null: not a token, not in the table, or its
   *  user is gone. The last use is written at most once an hour. */
  async lookup(token: string | null): Promise<{ user: User; agent: AgentRecord } | null> {
    if (token === null || !RE.agentToken.test(token)) return null;
    const hash = sha256hex(token);
    const found = this.#byHash.get(hash);
    if (!found) return null;
    const user = this.userById(found.userId);
    if (!user) return null;
    const t = this.now();
    if (found.used === null || t - Date.parse(found.used) >= AGENT_TOUCH_MS) {
      const again = await this.locks.accounts.run(async () => {
        // Under the lock: the token may have been revoked, or its user removed, meanwhile.
        const r = this.#byHash.get(hash);
        if (!r || !this.userById(r.userId)) return null;
        const touched = { ...r, used: new Date(t).toISOString() };
        try {
          await this.#save(this.records.map((x) => (x.id === r.id ? touched : x)));
          return touched;
        } catch (e) {
          // The time of the last use is not worth refusing a request for.
          this.log.error(`agents.json could not be written: ${(e as NodeJS.ErrnoException).code ?? (e as Error).name}`);
          return r;
        }
      });
      return again ? { user, agent: again } : null;
    }
    return { user, agent: found };
  }

  /** 3.3: counts one changing request of `bytes` body bytes for a person, or refuses it with
   *  429 when the minute's or the day's limit is passed. A refused request counts toward the
   *  minute, and its bytes do not count toward the day. */
  count(userId: string, bytes: number): void {
    const t = this.now();
    const changes = (this.#changes.get(userId) ?? []).filter((at) => t - at < MINUTE_MS);
    const sent = (this.#bytes.get(userId) ?? []).filter((x) => t - x.at < DAY_MS);
    const used = sent.reduce((n, x) => n + x.bytes, 0);
    const overCount = changes.length >= LIMITS.agentChanges;
    const overBytes = used + bytes > LIMITS.agentBytesPerDay;
    changes.push(t);
    // A person's table never holds more than the limit and what one minute can add to it.
    this.#changes.set(userId, changes.slice(-LIMITS.agentChanges * 4));
    if (overCount) {
      const wait = Math.max(1, Math.ceil((changes[changes.length - LIMITS.agentChanges - 1] + MINUTE_MS - t) / 1000));
      this.#bytes.set(userId, sent);
      throw new HttpError(429, `Agents may make at most ${LIMITS.agentChanges} changes a minute for one person.`, {}, "busy", `Wait ${wait} seconds, then send the request again. Reading is not limited.`);
    }
    if (overBytes) {
      this.#bytes.set(userId, sent);
      const hours = sent.length ? Math.max(1, Math.ceil((sent[0].at + DAY_MS - t) / 3_600_000)) : 24;
      throw new HttpError(
        429,
        `Agents may send at most ${Math.round(LIMITS.agentBytesPerDay / MB)} MB in 24 hours for one person.`,
        { size: bytes, used, limit: LIMITS.agentBytesPerDay },
        "busy",
        `This request has ${bytes} bytes and ${used} of ${LIMITS.agentBytesPerDay} are used. Send something smaller, or try again in about ${hours} hours.`,
      );
    }
    sent.push({ at: t, bytes });
    this.#bytes.set(userId, sent);
  }
}
