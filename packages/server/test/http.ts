// Test helpers for the server (SPEC2 12): a server on a temporary data folder, users, and
// requests that carry the cookie and the Origin header a browser would send (`fastify.inject`).

import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp, SESSION_COOKIE } from "../src/app.ts";
import { configFromEnv, type Config } from "../src/config.ts";
import { Context } from "../src/context.ts";
import type { Logger } from "../src/log.ts";

export const PASSWORD = "correct horse battery";
export const NO_GOOGLE = { list: "http://127.0.0.1:9", css: "http://127.0.0.1:9", files: "http://127.0.0.1:9" };
export const HOST = "notes.test";
/** The Origin a browser sends to the test server, which is reached without a proxy, over HTTP. */
export const ORIGIN = `http://${HOST}`;

export async function tempDir(prefix = "notes-v2-test-"): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export interface TestServer {
  ctx: Context;
  app: FastifyInstance;
  root: string;
  logs: string[];
  config: Config;
}

export async function startServer(over: Partial<Config> = {}, root?: string): Promise<TestServer> {
  root ??= await tempDir();
  const logs: string[] = [];
  const log: Logger = { info: (m) => logs.push(m), error: (m) => logs.push(m) };
  // Tests never contact Google: unless a test gives a fake Google server, the addresses are a
  // closed local port.
  const config: Config = { ...configFromEnv({}), dataDir: root, webDist: "/nonexistent", google: NO_GOOGLE, googleInsecure: true, ...over };
  const ctx = new Context(config, log);
  await ctx.start();
  const app = await buildApp(ctx);
  return { ctx, app, root, logs, config };
}

export class Client {
  app: FastifyInstance;
  cookie = "";
  ip = "203.0.113.7";

  constructor(app: FastifyInstance) {
    this.app = app;
  }

  async login(username: string, password = PASSWORD): Promise<LightMyRequestResponse> {
    const r = await this.req("POST", "/api/login", { username, password });
    const set = r.cookies.find((c) => c.name === SESSION_COOKIE);
    if (set) this.cookie = set.value;
    return r;
  }

  req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> {
    const h: Record<string, string> = { host: HOST, ...headers };
    if (method !== "GET" && method !== "HEAD" && !("origin" in headers)) h.origin = ORIGIN;
    if (this.cookie) h.cookie = `${SESSION_COOKIE}=${this.cookie}`;
    let payload: string | Buffer | undefined;
    if (Buffer.isBuffer(body)) payload = body;
    else if (typeof body === "string") payload = body;
    else if (body !== undefined) {
      payload = JSON.stringify(body);
      if (!("content-type" in h)) h["content-type"] = "application/json";
    }
    return this.app.inject({ method: method as "GET", url, headers: h, payload, remoteAddress: this.ip });
  }

  get(url: string) {
    return this.req("GET", url);
  }
  post(url: string, body?: unknown) {
    return this.req("POST", url, body);
  }
  del(url: string) {
    return this.req("DELETE", url);
  }

  /** A save: the bytes as text/markdown with If-Match. */
  save(id: string, text: string | Buffer, revision: string) {
    return this.req("PUT", `/api/notes/${id}`, Buffer.isBuffer(text) ? text : Buffer.from(text, "utf8"), { "content-type": "text/markdown", "if-match": revision });
  }

  saveAsNew(text: string, from?: string) {
    return this.req("POST", `/api/notes${from ? `?from=${from}` : ""}`, Buffer.from(text, "utf8"), { "content-type": "text/markdown" });
  }

  async create(title?: string): Promise<{ id: string; revision: string; text: string }> {
    const r = await this.post("/api/notes", title === undefined ? {} : { title });
    if (r.statusCode !== 201) throw new Error(`create: ${r.statusCode} ${r.body}`);
    return r.json();
  }
}

/** A server with two users, alice and bob, logged in. */
export async function twoUsers(over: Partial<Config> = {}): Promise<{ s: TestServer; alice: Client; bob: Client }> {
  const s = await startServer(over);
  await s.ctx.addUser("alice", PASSWORD);
  await s.ctx.addUser("bob", PASSWORD);
  const alice = new Client(s.app);
  const bob = new Client(s.app);
  bob.ip = "198.51.100.9";
  await alice.login("alice");
  await bob.login("bob");
  return { s, alice, bob };
}

/** A multipart body with one file field named "file". */
export function multipart(fileName: string, data: Buffer, type = "application/octet-stream"): { body: Buffer; headers: Record<string, string> } {
  const boundary = "----notes-test-boundary";
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${type}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, data, tail]), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

export async function ls(dir: string): Promise<string[]> {
  return (await fs.readdir(dir).catch(() => [])).sort();
}

export function userDir(s: TestServer, username: string): string {
  return path.join(s.root, "users", s.ctx.accounts.byName(username)!.id);
}
