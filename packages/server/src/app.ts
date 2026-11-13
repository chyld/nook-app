// The HTTP side (SPEC2 5 and 6): Fastify, every route registered from `contract` with its
// schemas (a request that does not match is refused with 400 before any handler runs), the
// session and origin checks, headers, logs, and the app's page with its content security policy.

import { randomBytes } from "node:crypto";
import { Transform } from "node:stream";
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { FileHandle } from "node:fs/promises";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { Value } from "@sinclair/typebox/value";
import { DRAWING_TYPE, kindOfType, LIMITS, PAGES, routes, type Answer, type Kind, type RouteDef, type RouteName } from "../../contract/src/index.ts";
import { Accounts, type User } from "./accounts.ts";
import type { Context } from "./context.ts";
import { errorBody, HttpError } from "./errors.ts";
import { Fonts } from "./fonts.ts";
import { PathError } from "./layout.ts";
import { CONTENT_TYPE, EXTENSION, photoBaseName, photoSlot, processImage, sniff } from "./photos.ts";
import { LinkRefused } from "./safefs.ts";
import { deleteStyle, putStyle, readStyles } from "./styles.ts";

export const SESSION_COOKIE = "notes_session";

declare module "fastify" {
  interface FastifyRequest {
    user?: User;
    tokenHash?: string;
    started?: bigint;
  }
  interface FastifyContextConfig {
    auth?: boolean;
    body?: string;
  }
}

/** SPEC-DRAWINGS 3.2: one policy, a loose one, sent with every page. The style nonce is not in
 *  it (a nonce would switch 'unsafe-inline' off); the page keeps its `csp-nonce` meta tag. */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "connect-src 'self' data: blob: https:",
  "worker-src 'self' blob:",
  "frame-src https:",
  "media-src 'self' data: blob: https:",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

type Handler<N extends RouteName> = (req: FastifyRequest, reply: FastifyReply) => Promise<Answer<N> | FastifyReply | void>;
type Handlers = { [N in RouteName]: Handler<N> };

const CHANGING_TYPES = new Set(["application/json", "text/markdown", DRAWING_TYPE, "multipart/form-data"]);

/** A request's body type, without its parameters. */
const bodyType = (req: FastifyRequest): string => (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();

export async function buildApp(ctx: Context): Promise<FastifyInstance> {
  const trusted = ctx.config.trustedProxy;
  const trustedAddresses = new Set<string>();
  const app = Fastify({
    logger: false,
    bodyLimit: LIMITS.jsonBody,
    // Section 5: X-Forwarded-For is trusted only from Caddy.
    trustProxy: trusted ? (address: string) => trustedAddresses.has(address) : false,
    routerOptions: { ignoreTrailingSlash: false },
  });
  if (trusted) {
    const refresh = async () => {
      try {
        const { lookup } = await import("node:dns/promises");
        const found = await lookup(trusted, { all: true });
        trustedAddresses.clear();
        for (const a of found) {
          trustedAddresses.add(a.address);
          if (a.family === 4) trustedAddresses.add(`::ffff:${a.address}`);
        }
      } catch {
        // Keep the last known addresses.
      }
    };
    let timer: NodeJS.Timeout;
    const loop = async () => {
      await refresh();
      timer = setTimeout(loop, trustedAddresses.size ? 60_000 : 2_000);
      timer.unref();
    };
    await loop();
    app.addHook("onClose", async () => clearTimeout(timer));
  }

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: LIMITS.photoBytes, files: 1, fields: 0, parts: 2 } });
  // A note travels as its raw bytes (4.4), and so does a drawing (SPEC-DRAWINGS 5).
  app.removeContentTypeParser("text/plain");
  app.addContentTypeParser("text/markdown", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
  app.addContentTypeParser(DRAWING_TYPE, { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  // --- every request ---------------------------------------------------------------------------
  app.addHook("onRequest", async (req) => {
    req.started = process.hrtime.bigint();
    if (req.method === "GET" || req.method === "HEAD") return;
    // Section 5: a change comes from this site: the same scheme, host and port. The scheme is the
    // request's own, or the one Caddy says the browser used (X-Forwarded-Proto, trusted only
    // from Caddy).
    const origin = req.headers.origin;
    const host = req.headers.host;
    let ok = false;
    try {
      ok = typeof origin === "string" && typeof host === "string" && new URL(origin).origin === new URL(`${req.protocol}://${host}`).origin;
    } catch {
      ok = false;
    }
    if (!ok) throw new HttpError(403, "This request did not come from this site.");
    const type = bodyType(req);
    const hasBody = Number(req.headers["content-length"] ?? "0") > 0 || req.headers["transfer-encoding"] !== undefined;
    if ((type !== "" || hasBody) && !CHANGING_TYPES.has(type)) throw new HttpError(415, `Requests that change something are JSON, text/markdown, ${DRAWING_TYPE} or a file upload.`);
    const want = req.routeOptions.config?.body;
    if (want === undefined) return;
    const fits =
      want === "none" ? !hasBody || type === "application/json" :
      want === "json" ? type === "application/json" :
      want === "markdown" ? type === "text/markdown" :
      want === "multipart" ? type === "multipart/form-data" :
      want === "document" ? kindOfType(type) !== null :
      want === "json-or-document" ? type === "application/json" || kindOfType(type) !== null :
      type === "application/json" || type === "text/markdown";
    if (!fits) throw new HttpError(415, "This request has the wrong kind of body.");
  });

  // Section 6: JSON bodies are at most 64 KB, also on a route that takes a larger Markdown body
  // (POST /api/notes; review, 34). Counted as it arrives, so a body without a length is too.
  app.addHook("preParsing", async (req, _reply, payload) => {
    const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    const limit = req.routeOptions.bodyLimit;
    if (type !== "application/json" || limit === undefined || limit <= LIMITS.jsonBody) return payload;
    if (Number(req.headers["content-length"] ?? "0") > LIMITS.jsonBody) throw new HttpError(413, "A JSON body may be at most 64 KB.");
    let seen = 0;
    return payload.pipe(
      new Transform({
        transform(chunk: Buffer, _enc, done) {
          seen += chunk.length;
          if (seen > LIMITS.jsonBody) done(Object.assign(new HttpError(413, "A JSON body may be at most 64 KB."), { statusCode: 413 }));
          else done(null, chunk);
        },
      }),
    );
  });

  app.addHook("preHandler", async (req, reply) => {
    if (req.routeOptions.config?.auth === false || req.routeOptions.url === undefined) return;
    const result = await ctx.accounts.session(req.cookies[SESSION_COOKIE]);
    if (!result) throw new HttpError(401, "Please log in.");
    req.user = result.user;
    req.tokenHash = result.tokenHash;
    if (result.refreshMaxAge !== undefined) setSessionCookie(reply, req.cookies[SESSION_COOKIE]!, result.refreshMaxAge);
  });

  app.addHook("onSend", async (_req, reply, payload) => {
    if (!reply.hasHeader("cache-control")) reply.header("cache-control", "no-store");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-content-type-options", "nosniff");
    return payload;
  });

  // Section 5: method, route pattern, status and time. Nothing else.
  app.addHook("onResponse", async (req, reply) => {
    const ms = req.started ? Number(process.hrtime.bigint() - req.started) / 1e6 : 0;
    ctx.log.info(`${req.method} ${req.routeOptions.url ?? "(no route)"} ${reply.statusCode} ${ms.toFixed(1)}ms`);
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send(err.body);
    if (err instanceof LinkRefused || err instanceof PathError) return reply.status(404).send(errorBody(404, "Not found."));
    const e = err as { statusCode?: number; validation?: unknown; code?: string };
    if (e.validation) return reply.status(400).send(errorBody(400, "The request does not match its schema."));
    const status = e.statusCode;
    if (status && status >= 400 && status < 500) {
      const message = status === 413 ? "The request is too large." : status === 415 ? "Unsupported content type." : "Bad request.";
      return reply.status(status).send(errorBody(status, message));
    }
    ctx.log.error(`${req.method} ${req.routeOptions.url ?? ""} failed: ${(err as NodeJS.ErrnoException).code ?? (err as Error).name}`);
    return reply.status(500).send(errorBody(500, "Something went wrong on the server."));
  });

  // --- helpers ---------------------------------------------------------------------------------
  const userOf = (req: FastifyRequest): User => {
    if (!req.user) throw new HttpError(401, "Please log in.");
    return req.user;
  };
  const run = <T>(req: FastifyRequest, fn: Parameters<typeof ctx.spaces.run<T>>[1]) => ctx.spaces.run(userOf(req).id, fn);
  const params = (req: FastifyRequest) => req.params as Record<string, string>;
  const bytesOf = (req: FastifyRequest): Buffer => {
    if (!Buffer.isBuffer(req.body)) throw new HttpError(400, `A note's text is sent as text/markdown, a drawing as ${DRAWING_TYPE}.`);
    return req.body;
  };
  /** The kind a document body's type names (the body check let only those two through). */
  const kindOfBody = (req: FastifyRequest): Kind => kindOfType(bodyType(req)) ?? "note";
  const fonts = new Fonts(ctx);

  const sendFile = (reply: FastifyReply, f: { fh: FileHandle; size: number }, type: string) => {
    reply.header("cache-control", "private");
    reply.header("content-length", String(f.size));
    reply.type(type);
    return reply.send(f.fh.createReadStream({ start: 0, autoClose: true }));
  };
  /** A photo is served only if its bytes are one of the five types (section 6). */
  const sendPhoto = async (reply: FastifyReply, f: { fh: FileHandle; size: number; head: Buffer }) => {
    const type = sniff(f.head);
    if (!type) {
      await f.fh.close();
      throw new HttpError(404, "There is no such photo.");
    }
    return sendFile(reply, f, CONTENT_TYPE[type]);
  };

  // --- the handlers ----------------------------------------------------------------------------
  const handlers: Handlers = {
    login: async (req, reply) => {
      const b = req.body as { username: string; password: string };
      const { token, user } = await ctx.accounts.login(b.username, b.password, req.ip);
      setSessionCookie(reply, token, Accounts.newMaxAge());
      return { user: { id: user.id, username: user.username } };
    },
    logout: async (req, reply) => {
      await ctx.accounts.logout(req.tokenHash!);
      reply.clearCookie(SESSION_COOKIE, { path: "/", httpOnly: true, secure: true, sameSite: "lax" });
      return {};
    },
    me: async (req) => {
      const u = userOf(req);
      return { user: { id: u.id, username: u.username }, lastBackup: await ctx.accounts.lastBackup() };
    },
    password: async (req) => {
      const b = req.body as { current: string; next: string };
      await ctx.accounts.changePassword(userOf(req), req.tokenHash!, b.current, b.next, req.ip);
      return {};
    },
    list: async (req) => {
      const q = req.query as { tag?: string; q?: string };
      return run(req, (s) => s.list(q.tag || undefined, q.q || undefined));
    },
    create: async (req, reply) => {
      const q = req.query as { from?: string };
      if (Buffer.isBuffer(req.body)) {
        const body = req.body;
        const kind = kindOfBody(req);
        const r = await run(req, (s) => s.saveAsNew(body, q.from, kind));
        return reply.status(201).send({ id: r.id, revision: r.revision, entry: r.entry, text: r.text, photosMissing: r.photosMissing });
      }
      // No body is `{}`; any JSON body, `null` too, must match the schema.
      const b = req.body === undefined ? {} : req.body;
      if (!Value.Check(routes.create.json, b)) throw new HttpError(400, "The request does not match its schema.");
      const j = b as { title?: string; kind?: Kind };
      const r = await run(req, (s) => s.create(j.title, j.kind ?? "note"));
      return reply.status(201).send({ id: r.id, revision: r.revision, entry: r.entry, text: r.text, photosMissing: false });
    },
    read: async (req) => run(req, (s) => s.read(params(req).id)),
    save: async (req) => {
      const bytes = bytesOf(req);
      const rev = String(req.headers["if-match"] ?? "").replace(/^"|"$/g, "");
      const kind = kindOfBody(req);
      return run(req, (s) => s.save(params(req).id, rev, bytes, kind));
    },
    trash: async (req) => {
      await run(req, (s) => s.trash(params(req).id));
      return {};
    },
    history: async (req) => ({ versions: await run(req, (s) => s.history(params(req).id)) }),
    version: async (req) => ({ text: await run(req, (s) => s.version(params(req).id, params(req).version)) }),
    upload: async (req) => {
      const id = params(req).id;
      // Slow work before the lock: receive, check the type, process.
      const declared = Number(req.headers["content-length"] ?? "0");
      if (declared > LIMITS.photoBytes + 64 * 1024) throw new HttpError(413, "A photo may be at most 25 MB.");
      // The body is read only once the upload has a processing slot, which it keeps until the
      // photo is stored: at most two uploads are in memory at once (finding 13).
      const file = await photoSlot(async () => {
        const part = await req.file();
        if (!part) throw new HttpError(400, "No file was sent.");
        let data: Buffer;
        try {
          data = await part.toBuffer();
        } catch {
          throw new HttpError(413, "A photo may be at most 25 MB.");
        }
        if (part.file.truncated) throw new HttpError(413, "A photo may be at most 25 MB.");
        const type = sniff(data.subarray(0, 64));
        if (!type) throw new HttpError(422, "Only JPEG, PNG, WebP, GIF and AVIF photos can be added.", {}, "not-an-image");
        // The note must exist before the work is done; it is checked again under the lock. A
        // drawing has no photos (SPEC-DRAWINGS 5).
        if ((await run(req, (s) => s.live(id))).kind === "drawing") throw new HttpError(404, "A drawing keeps its images inside its file.");
        const done = await processImage(data, type);
        return run(req, (s) => s.storePhoto(id, photoBaseName(part.filename ?? ""), EXTENSION[type], done));
      });
      return { file };
    },
    asset: async (req, reply) => sendPhoto(reply, await run(req, (s) => s.openAsset(params(req).id, params(req).file, "notes"))),
    trashList: async (req) => ({ entries: await run(req, (s) => s.listTrash()) }),
    trashRead: async (req) => run(req, (s) => s.readTrash(params(req).id)),
    trashAsset: async (req, reply) => sendPhoto(reply, await run(req, (s) => s.openAsset(params(req).id, params(req).file, "trash"))),
    restore: async (req) => ({ entry: await run(req, (s) => s.restore(params(req).id)) }),
    empty: async (req) => {
      const ids = (req.body as { ids: string[] }).ids;
      return { removed: await run(req, (s) => s.empty(ids)) };
    },
    styles: async (req) => ({ styles: await run(req, (s) => readStyles(s)) }),
    styleSave: async (req) => {
      const b = req.body as { style: Parameters<typeof putStyle>[2]; renameFrom?: string };
      return { styles: await run(req, (s) => putStyle(s, params(req).name, b.style, b.renameFrom)) };
    },
    styleDelete: async (req) => ({ styles: await run(req, (s) => deleteStyle(s, params(req).name)) }),
    catalogue: async (req) => {
      const q = req.query as { q?: string; category?: string; offset?: number };
      try {
        const r = await fonts.search(q.q ?? "", q.category ?? "", q.offset ?? 0);
        const all = await fonts.catalogue();
        const categories = [...new Set(all.map((f) => f.category).filter(Boolean))].sort();
        return { families: r.families.map(({ family, slug, category }) => ({ family, slug, category })), total: r.total, categories, available: true };
      } catch (e) {
        if (e instanceof HttpError && e.status === 503) return { families: [], total: 0, categories: [], available: false };
        throw e;
      }
    },
    preview: async (req, reply) => {
      const data = await fonts.preview(params(req).slug);
      reply.header("cache-control", "private");
      reply.type("font/woff2");
      return reply.send(data);
    },
    fonts: async (req) => {
      const space = ctx.spaces.get(userOf(req).id);
      return { fonts: await space.lock.run(() => fonts.installed(space)) };
    },
    fontAdd: async (req) => {
      const space = ctx.spaces.get(userOf(req).id);
      await fonts.add(space, (req.body as { slug: string }).slug);
      return { fonts: await space.lock.run(() => fonts.installed(space)) };
    },
    fontRemove: async (req) => {
      const space = ctx.spaces.get(userOf(req).id);
      await fonts.remove(space, params(req).slug);
      return { fonts: await space.lock.run(() => fonts.installed(space)) };
    },
    fontsCss: async (req, reply) => {
      const css = await fonts.css(ctx.spaces.get(userOf(req).id));
      reply.type("text/css; charset=utf-8");
      return reply.send(css);
    },
    fontFile: async (req, reply) => sendFile(reply, await fonts.open(ctx.spaces.get(userOf(req).id), params(req).slug, params(req).file), "font/woff2"),
  };
  for (const name of Object.keys(routes) as RouteName[]) {
    const d = routes[name] as RouteDef;
    const schema: Record<string, unknown> = {};
    if (d.params) schema.params = d.params;
    if (d.query) schema.querystring = d.query;
    if (d.headers) schema.headers = d.headers;
    if (d.json && d.body === "json") schema.body = d.json;
    app.route({
      method: d.method,
      url: d.url,
      schema,
      bodyLimit: d.bodyLimit,
      config: { auth: d.auth, body: d.body },
      handler: handlers[name] as Handler<RouteName>,
    });
  }

  // --- the page and its bundle -------------------------------------------------------------------
  const page = await loadPage(ctx.config.webDist);
  const sendPage = (reply: FastifyReply, status = 200) => {
    const nonce = randomBytes(16).toString("base64");
    reply.header("content-security-policy", CSP);
    reply.header("x-frame-options", "DENY");
    reply.type("text/html; charset=utf-8");
    return reply.status(status).send(page.replaceAll("__CSP_NONCE__", nonce));
  };
  for (const p of PAGES) app.get(p, { config: { auth: false } }, async (_req, reply) => sendPage(reply));

  app.get("/assets/*", { config: { auth: false } }, async (req, reply) => {
    const rel = (req.params as { "*": string })["*"];
    if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(rel) || rel.split("/").some((p) => p.startsWith("."))) throw new HttpError(404, "Not found.");
    const type = ASSET_TYPES[path.extname(rel)];
    if (!type) throw new HttpError(404, "Not found.");
    const data = await fsp.readFile(path.join(ctx.config.webDist, "assets", rel)).catch(() => null);
    if (!data) throw new HttpError(404, "Not found.");
    reply.header("cache-control", "public, max-age=31536000, immutable");
    reply.type(type);
    return reply.send(data);
  });

  app.get("/favicon.svg", { config: { auth: false } }, async (_req, reply) => {
    reply.header("cache-control", "public, max-age=86400");
    reply.type("image/svg+xml");
    return reply.send(FAVICON);
  });

  // An unknown address: the page, which shows "Not found" (9.1); under /api, a JSON 404.
  app.setNotFoundHandler((req, reply) => {
    if (req.method === "GET" && !req.url.startsWith("/api/") && !req.url.startsWith("/assets/")) return sendPage(reply, 404);
    return reply.status(404).send(errorBody(404, "Not found."));
  });

  return app;
}

const ASSET_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

// The Nook mark (the same drawing as web/src/components/Logo.svelte, with fixed colours).
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#6d3bf5"/><path d="M10 24.5V15a6 6 0 0 1 12 0v9.5" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="21" r="2.6" fill="#ffcf33"/></svg>`;

/** The built index.html, or a small page when the web bundle has not been built (tests). */
async function loadPage(dist: string): Promise<string> {
  const built = await fsp.readFile(path.join(dist, "index.html"), "utf8").catch(() => null);
  if (built) return built;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="csp-nonce" content="__CSP_NONCE__"><title>Nook</title></head><body><p>The web app has not been built. Run npm run build.</p></body></html>`;
}

export function setSessionCookie(reply: FastifyReply, token: string, maxAge: number): void {
  reply.setCookie(SESSION_COOKIE, token, { path: "/", httpOnly: true, secure: true, sameSite: "lax", maxAge });
}
