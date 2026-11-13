// The API contract (SPEC2 section 6): patterns, limits, request and answer shapes, and every
// route, declared once with TypeBox. The server registers its routes from `routes`; the
// browser's client is typed from the same declarations. Nothing here runs I/O.

import { Type, type Static, type TSchema } from "@sinclair/typebox";

// --- sizes and limits -------------------------------------------------------------------------

export const KB = 1024;
export const MB = 1024 * 1024;

export const LIMITS = {
  /** A note's bytes (SPEC2 4.4). */
  noteBytes: 2 * MB,
  /** A drawing's bytes, its images included (SPEC-DRAWINGS 4.4; Caddy allows 27 MB). */
  drawingBytes: 25 * MB,
  /** The versions a drawing keeps (SPEC-DRAWINGS 4.4): each repeats its images. */
  drawingHistory: 20,
  /** JSON bodies; login and password bodies (section 6). */
  jsonBody: 64 * KB,
  loginBody: 1 * KB,
  /** A photo upload (section 6; Caddy allows 27 MB). */
  photoBytes: 25 * MB,
  passwordMin: 5,
  passwordMax: 256,
  usernameMax: 64,
  titleMax: 300,
  tagMax: 30,
  fonts: 40,
  styles: 50,
  styleName: 40,
  history: 50,
  /** Photos (section 6). */
  stillSide: 2560,
  animatedSide: 1280,
  stillPixels: 120_000_000,
  animatedPixels: 25_000_000,
  /** Fonts fetched from Google (section 5). */
  fontFetchBytes: 5 * MB,
  fontFetchMs: 20_000,
  /** One page of the font catalogue. */
  cataloguePage: 30,
  /** Size in points (7.6). */
  sizeMin: 1,
  sizeMax: 400,
  /** Agents (SPEC-AGENTS 2.1, 3.3, 4.3): tokens a person may have; the length of a name;
   *  changing requests a minute and body bytes a day, per person; the versions of an agent's
   *  kept for a note and for a drawing. */
  agents: 20,
  agentName: 40,
  agentChanges: 60,
  agentBytesPerDay: 300 * MB,
  agentHistory: 10,
  agentDrawingHistory: 5,
} as const;

// --- patterns ---------------------------------------------------------------------------------

/** Lower-case base-32. */
export const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

export const PATTERNS = {
  noteId: "^[a-z2-7]{24}$",
  userId: "^[a-z2-7]{16}$",
  /** A history version: the save time in UTC and four random characters (4.2). */
  version: "^\\d{4}-\\d\\d-\\d\\dT\\d\\d-\\d\\d-\\d\\d\\.\\d{3}Z-[a-z2-7]{4}$",
  /** A font family slug (section 6). */
  fontSlug: "^[a-z0-9-]{1,60}$",
  /** A font file the server stores (`regular.woff2`, `bold-italic.woff2`, `latin-ext-400-normal.woff2`). */
  fontFile: "^[a-z0-9-]{1,80}\\.woff2$",
  /** A stored photo name (section 6): `A-Z a-z 0-9 _ -`, then the type's extension. */
  photoFile: "^[A-Za-z0-9_-]{1,120}\\.(jpg|png|webp|gif|avif)$",
  /** A tag the app writes (7.6). */
  tag: "^[a-z]{1,30}$",
  revision: "^[0-9a-f]{64}$",
  /** A saved style's name: 1 to 40 characters, no control characters. */
  styleName: "^[^\\u0000-\\u001f\\u007f]{1,40}$",
  /** An agent's token (SPEC-AGENTS 2.1): `nook_` and 40 base-32 characters. */
  agentToken: "^nook_[a-z2-7]{40}$",
  /** A token's id. */
  agentId: "^[a-z2-7]{16}$",
  /** An agent's name: 1 to 40 characters, no C0 or C1 control character. */
  agentName: "^[^\\u0000-\\u001f\\u007f-\\u009f]{1,40}$",
} as const;

export const RE = Object.fromEntries(Object.entries(PATTERNS).map(([k, v]) => [k, new RegExp(v, "u")])) as Record<keyof typeof PATTERNS, RegExp>;

export const isNoteId = (s: unknown): s is string => typeof s === "string" && RE.noteId.test(s);
export const isVersion = (s: unknown): s is string => typeof s === "string" && RE.version.test(s);

/** `n` random base-32 characters (Web Crypto: Node and browsers). */
export function randomBase32(n: number): string {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += BASE32[b & 31];
  return s;
}

export const newNoteId = (): string => randomBase32(24);
export const newUserId = (): string => randomBase32(16);
export const newAgentId = (): string => randomBase32(16);
/** A new agent token (SPEC-AGENTS 2.1): 200 random bits. */
export const newAgentToken = (): string => "nook_" + randomBase32(40);
/** The path every agent address begins with (SPEC-AGENTS 3.2), and the agent routes' base. */
export const AGENT_PREFIX = "/api/agent/";
export const AGENT_BASE = "/api/agent/v1";
/** True for a request path (with or without a query) under `/api/agent/`. */
export const isAgentPath = (url: string): boolean => url.split("?")[0].startsWith(AGENT_PREFIX);
/** The name of an agent's version whose writer is not recorded (SPEC-AGENTS 4.1). */
export const UNNAMED_AGENT = "an agent";

/** A history version for a save at `date`: `2026-11-10T14-02-11.512Z-k3fa`. */
export function makeVersion(date: Date, random = randomBase32(4)): string {
  return date.toISOString().replace(/:/g, "-") + "-" + random;
}

/** The app's own clipboard type (7.6). */
export const CLIPBOARD_TYPE = "text/x-notes-markdown";

// --- kinds (SPEC-DRAWINGS) --------------------------------------------------------------------

/** What an item is: a note (`note.md`) or a drawing (`drawing.excalidraw`). */
export type Kind = "note" | "drawing";
export const KINDS: readonly Kind[] = ["note", "drawing"];

/** A drawing's body type (SPEC-DRAWINGS 5). */
export const DRAWING_TYPE = "application/vnd.excalidraw+json";
/** The body type of each kind's document. */
export const DOCUMENT_TYPE: Record<Kind, string> = { note: "text/markdown", drawing: DRAWING_TYPE };
/** The kind a document body type names, or null. */
export const kindOfType = (type: string): Kind | null => (type === "text/markdown" ? "note" : type === DRAWING_TYPE ? "drawing" : null);
/** Each kind's largest document and its history (SPEC2 4.4, 4.6; SPEC-DRAWINGS 4.4). */
export const KIND_LIMITS: Record<Kind, { bytes: number; history: number; agentHistory: number }> = {
  note: { bytes: LIMITS.noteBytes, history: LIMITS.history, agentHistory: LIMITS.agentHistory },
  drawing: { bytes: LIMITS.drawingBytes, history: LIMITS.drawingHistory, agentHistory: LIMITS.agentDrawingHistory },
};
/** The limit of the routes that take a document: the larger kind's, with room so that the
 *  kind's own check answers (with the size) rather than the route's (as for photos). */
const DOCUMENT_LIMIT = Math.max(LIMITS.noteBytes, LIMITS.drawingBytes) + 64 * KB;

// --- shapes -----------------------------------------------------------------------------------

const NoteId = Type.String({ pattern: PATTERNS.noteId });
const Version = Type.String({ pattern: PATTERNS.version });
const Slug = Type.String({ pattern: PATTERNS.fontSlug });
const FontFile = Type.String({ pattern: PATTERNS.fontFile });
const PhotoFile = Type.String({ pattern: PATTERNS.photoFile });
const StyleName = Type.String({ pattern: PATTERNS.styleName });
const Revision = Type.String({ pattern: PATTERNS.revision });
const Nullable = <T extends TSchema>(t: T) => Type.Union([t, Type.Null()]);
const KindSchema = Type.Union([Type.Literal("note"), Type.Literal("drawing")]);

/** `hint`: what to do next, on an agent address (SPEC-AGENTS 5.8). */
export const ErrorBody = Type.Object({
  error: Type.Object({ code: Type.String(), message: Type.String(), hint: Type.Optional(Type.String()) }),
});

/** One note of the list (4.5). */
export const Entry = Type.Object({
  id: NoteId,
  kind: KindSchema,
  title: Type.String(),
  tags: Type.Array(Type.String()),
  created: Nullable(Type.String()),
  /** Modification time, milliseconds since 1970. */
  modified: Type.Number(),
  size: Type.Number(),
  /** "broken": the front matter does not parse (opens in Raw). "unreadable": not UTF-8. */
  problem: Type.Optional(Type.Union([Type.Literal("broken"), Type.Literal("unreadable")])),
  excerpt: Type.Optional(Type.String()),
  /** The agent whose request wrote the file as it is now, or null (SPEC-AGENTS 4.1). */
  agent: Nullable(Type.String()),
});

export const TagCount = Type.Object({ tag: Type.String(), count: Type.Number() });

export const NoteDoc = Type.Object({ text: Type.String(), revision: Revision, entry: Entry });

export const ConflictBody = Type.Object({
  error: Type.Object({ code: Type.String(), message: Type.String(), hint: Type.Optional(Type.String()) }),
  current: Type.Optional(NoteDoc),
});

export const User = Type.Object({ id: Type.String(), username: Type.String() });

/** `agent`: null for a person's version, the name for an agent's (SPEC-AGENTS 4.1). */
export const HistoryEntry = Type.Object({ version: Version, time: Type.String(), size: Type.Number(), agent: Nullable(Type.String()) });

/** An agent's token as the Account screen lists it (SPEC-AGENTS 2.2); never the token. */
export const Agent = Type.Object({
  id: Type.String({ pattern: PATTERNS.agentId }),
  name: Type.String(),
  created: Type.String(),
  used: Nullable(Type.String()),
});

export const TrashEntry = Type.Object({
  id: NoteId,
  kind: KindSchema,
  title: Type.String(),
  tags: Type.Array(Type.String()),
  trashed: Nullable(Type.String()),
  size: Type.Number(),
});

export const Style = Type.Object({
  name: StyleName,
  bold: Type.Boolean(),
  italic: Type.Boolean(),
  underline: Type.Boolean(),
  strike: Type.Boolean(),
  size: Nullable(Type.Number({ minimum: LIMITS.sizeMin, maximum: LIMITS.sizeMax })),
  font: Nullable(Type.String({ maxLength: 100 })),
  color: Nullable(Type.String({ maxLength: 40 })),
  bg: Nullable(Type.String({ maxLength: 40 })),
});

export const Font = Type.Object({ family: Type.String(), slug: Slug });

export const CatalogueFamily = Type.Object({ family: Type.String(), slug: Slug, category: Type.String() });

export type Entry = Static<typeof Entry>;
export type TagCount = Static<typeof TagCount>;
export type NoteDoc = Static<typeof NoteDoc>;
export type User = Static<typeof User>;
export type HistoryEntry = Static<typeof HistoryEntry>;
export type Agent = Static<typeof Agent>;
export type TrashEntry = Static<typeof TrashEntry>;
export type Style = Static<typeof Style>;
export type Font = Static<typeof Font>;
export type CatalogueFamily = Static<typeof CatalogueFamily>;
export type ErrorBody = Static<typeof ErrorBody>;
export type ConflictBody = Static<typeof ConflictBody>;

// --- routes -----------------------------------------------------------------------------------

/** How a route's body is sent: JSON, raw Markdown text, a multipart upload, or none.
 *  "document": a note's Markdown or a drawing's file (SPEC-DRAWINGS 5). */
export type BodyKind = "none" | "json" | "markdown" | "multipart" | "json-or-markdown" | "document" | "json-or-document";
/** What a route answers: JSON, or a file (bytes or CSS). */
export type ReplyKind = "json" | "file";

export type Auth = "session" | "token" | "none";

export interface RouteDef {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  /** How a request is let in (SPEC-AGENTS 3.1): by the session cookie, by an agent's token, or
   *  with no check. */
  auth: Auth;
  body: BodyKind;
  /** Largest body in bytes. */
  bodyLimit?: number;
  params?: TSchema;
  query?: TSchema;
  json?: TSchema;
  headers?: TSchema;
  reply: ReplyKind;
  answer?: TSchema;
}

const r = <T extends RouteDef>(d: T): T => d;

const Ok = Type.Object({});

export const routes = {
  login: r({
    method: "POST", url: "/api/login", auth: "none", body: "json", bodyLimit: LIMITS.loginBody, reply: "json",
    json: Type.Object({ username: Type.String({ minLength: 1, maxLength: LIMITS.usernameMax }), password: Type.String({ minLength: 1, maxLength: LIMITS.passwordMax }) }, { additionalProperties: false }),
    answer: Type.Object({ user: User }),
  }),
  logout: r({ method: "POST", url: "/api/logout", auth: "session", body: "none", reply: "json", answer: Ok }),
  me: r({
    method: "GET", url: "/api/me", auth: "session", body: "none", reply: "json",
    answer: Type.Object({ user: User, lastBackup: Nullable(Type.String()) }),
  }),
  password: r({
    method: "POST", url: "/api/password", auth: "session", body: "json", bodyLimit: LIMITS.loginBody, reply: "json",
    json: Type.Object({ current: Type.String({ minLength: 1, maxLength: LIMITS.passwordMax }), next: Type.String({ minLength: LIMITS.passwordMin, maxLength: LIMITS.passwordMax }) }, { additionalProperties: false }),
    answer: Ok,
  }),
  list: r({
    method: "GET", url: "/api/notes", auth: "session", body: "none", reply: "json",
    query: Type.Object({ tag: Type.Optional(Type.String({ maxLength: 100 })), q: Type.Optional(Type.String({ maxLength: 500 })) }, { additionalProperties: false }),
    answer: Type.Object({ entries: Type.Array(Entry), tags: Type.Array(TagCount) }),
  }),
  create: r({
    method: "POST", url: "/api/notes", auth: "session", body: "json-or-document", bodyLimit: DOCUMENT_LIMIT, reply: "json",
    query: Type.Object({ from: Type.Optional(NoteId) }, { additionalProperties: false }),
    json: Type.Object({ title: Type.Optional(Type.String({ maxLength: 2000 })), kind: Type.Optional(KindSchema) }, { additionalProperties: false }),
    answer: Type.Object({ id: NoteId, revision: Revision, entry: Entry, text: Type.String(), photosMissing: Type.Boolean() }),
  }),
  read: r({ method: "GET", url: "/api/notes/:id", auth: "session", body: "none", reply: "json", params: Type.Object({ id: NoteId }), answer: NoteDoc }),
  save: r({
    method: "PUT", url: "/api/notes/:id", auth: "session", body: "document", bodyLimit: DOCUMENT_LIMIT, reply: "json",
    params: Type.Object({ id: NoteId }),
    headers: Type.Object({ "if-match": Revision }),
    answer: Type.Object({ revision: Revision, entry: Entry }),
  }),
  trash: r({ method: "DELETE", url: "/api/notes/:id", auth: "session", body: "none", reply: "json", params: Type.Object({ id: NoteId }), answer: Ok }),
  history: r({
    method: "GET", url: "/api/notes/:id/history", auth: "session", body: "none", reply: "json",
    params: Type.Object({ id: NoteId }), answer: Type.Object({ versions: Type.Array(HistoryEntry) }),
  }),
  version: r({
    method: "GET", url: "/api/notes/:id/history/:version", auth: "session", body: "none", reply: "json",
    params: Type.Object({ id: NoteId, version: Version }), answer: Type.Object({ text: Type.String() }),
  }),
  upload: r({
    method: "POST", url: "/api/notes/:id/photos", auth: "session", body: "multipart", bodyLimit: LIMITS.photoBytes + 64 * KB, reply: "json",
    params: Type.Object({ id: NoteId }), answer: Type.Object({ file: PhotoFile }),
  }),
  asset: r({ method: "GET", url: "/api/notes/:id/assets/:file", auth: "session", body: "none", reply: "file", params: Type.Object({ id: NoteId, file: PhotoFile }) }),
  trashList: r({ method: "GET", url: "/api/trash", auth: "session", body: "none", reply: "json", answer: Type.Object({ entries: Type.Array(TrashEntry) }) }),
  trashRead: r({
    method: "GET", url: "/api/trash/:id", auth: "session", body: "none", reply: "json",
    params: Type.Object({ id: NoteId }), answer: Type.Object({ text: Type.String(), entry: TrashEntry }),
  }),
  trashAsset: r({ method: "GET", url: "/api/trash/:id/assets/:file", auth: "session", body: "none", reply: "file", params: Type.Object({ id: NoteId, file: PhotoFile }) }),
  restore: r({ method: "POST", url: "/api/trash/:id/restore", auth: "session", body: "none", reply: "json", params: Type.Object({ id: NoteId }), answer: Type.Object({ entry: Entry }) }),
  empty: r({
    method: "POST", url: "/api/trash/empty", auth: "session", body: "json", reply: "json",
    json: Type.Object({ ids: Type.Array(NoteId, { maxItems: 10000 }) }, { additionalProperties: false }),
    answer: Type.Object({ removed: Type.Array(NoteId) }),
  }),
  styles: r({ method: "GET", url: "/api/styles", auth: "session", body: "none", reply: "json", answer: Type.Object({ styles: Type.Array(Style) }) }),
  styleSave: r({
    method: "PUT", url: "/api/styles/:name", auth: "session", body: "json", reply: "json",
    params: Type.Object({ name: StyleName }),
    json: Type.Object({ style: Style, renameFrom: Type.Optional(StyleName) }, { additionalProperties: false }),
    answer: Type.Object({ styles: Type.Array(Style) }),
  }),
  styleDelete: r({
    method: "DELETE", url: "/api/styles/:name", auth: "session", body: "none", reply: "json",
    params: Type.Object({ name: StyleName }), answer: Type.Object({ styles: Type.Array(Style) }),
  }),
  catalogue: r({
    method: "GET", url: "/api/fonts/catalogue", auth: "session", body: "none", reply: "json",
    query: Type.Object({ q: Type.Optional(Type.String({ maxLength: 100 })), category: Type.Optional(Type.String({ maxLength: 40 })), offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })) }, { additionalProperties: false }),
    answer: Type.Object({ families: Type.Array(CatalogueFamily), total: Type.Number(), categories: Type.Array(Type.String()), available: Type.Boolean() }),
  }),
  preview: r({ method: "GET", url: "/api/fonts/preview/:slug", auth: "session", body: "none", reply: "file", params: Type.Object({ slug: Slug }) }),
  fonts: r({ method: "GET", url: "/api/fonts", auth: "session", body: "none", reply: "json", answer: Type.Object({ fonts: Type.Array(Font) }) }),
  fontAdd: r({
    method: "POST", url: "/api/fonts", auth: "session", body: "json", reply: "json",
    json: Type.Object({ slug: Slug }, { additionalProperties: false }), answer: Type.Object({ fonts: Type.Array(Font) }),
  }),
  fontRemove: r({ method: "DELETE", url: "/api/fonts/:slug", auth: "session", body: "none", reply: "json", params: Type.Object({ slug: Slug }), answer: Type.Object({ fonts: Type.Array(Font) }) }),
  fontsCss: r({ method: "GET", url: "/api/fonts.css", auth: "session", body: "none", reply: "file" }),
  fontFile: r({ method: "GET", url: "/api/fonts/:slug/:file", auth: "session", body: "none", reply: "file", params: Type.Object({ slug: Slug, file: FontFile }) }),

  // --- agents' tokens, for the browser (SPEC-AGENTS 2.2) ----------------------------------------
  agents: r({ method: "GET", url: "/api/agents", auth: "session", body: "none", reply: "json", answer: Type.Object({ agents: Type.Array(Agent) }) }),
  agentMake: r({
    method: "POST", url: "/api/agents", auth: "session", body: "json", reply: "json",
    json: Type.Object({ name: Type.String({ maxLength: 400 }) }, { additionalProperties: false }),
    answer: Type.Object({ agent: Agent, token: Type.String({ pattern: PATTERNS.agentToken }) }),
  }),
  agentRevoke: r({ method: "DELETE", url: "/api/agents/:id", auth: "session", body: "none", reply: "json", params: Type.Object({ id: Type.String({ pattern: PATTERNS.agentId }) }), answer: Ok }),

  // --- the agent routes (SPEC-AGENTS 5): a token, never a cookie; none of them deletes ---------
  agentGuide: r({ method: "GET", url: AGENT_BASE, auth: "none", body: "none", reply: "file" }),
  agentList: r({
    method: "GET", url: `${AGENT_BASE}/items`, auth: "token", body: "none", reply: "json",
    query: Type.Object({ tag: Type.Optional(Type.String({ maxLength: 100 })), q: Type.Optional(Type.String({ maxLength: 500 })) }, { additionalProperties: false }),
    answer: Type.Object({ entries: Type.Array(Entry), tags: Type.Array(TagCount) }),
  }),
  agentCreate: r({
    method: "POST", url: `${AGENT_BASE}/items`, auth: "token", body: "document", bodyLimit: DOCUMENT_LIMIT, reply: "json",
    // Longer than a title or a tag list may be, so that the handler answers with the reason.
    query: Type.Object({ title: Type.Optional(Type.String({ maxLength: 4000 })), tags: Type.Optional(Type.String({ maxLength: 4000 })) }, { additionalProperties: false }),
    answer: Type.Object({ id: NoteId, revision: Revision, entry: Entry, text: Type.String(), url: Type.String() }),
  }),
  agentRead: r({
    method: "GET", url: `${AGENT_BASE}/items/:id`, auth: "token", body: "none", reply: "json",
    params: Type.Object({ id: NoteId }), answer: Type.Object({ text: Type.String(), revision: Revision, entry: Entry, url: Type.String() }),
  }),
  agentText: r({ method: "GET", url: `${AGENT_BASE}/items/:id/text`, auth: "token", body: "none", reply: "file", params: Type.Object({ id: NoteId }) }),
  // No header schema: a save without If-Match is 428, which the handler answers (5.6).
  agentSave: r({
    method: "PUT", url: `${AGENT_BASE}/items/:id`, auth: "token", body: "document", bodyLimit: DOCUMENT_LIMIT, reply: "json",
    params: Type.Object({ id: NoteId }), answer: Type.Object({ revision: Revision, entry: Entry, url: Type.String() }),
  }),
  agentAppend: r({
    method: "POST", url: `${AGENT_BASE}/items/:id/append`, auth: "token", body: "markdown", bodyLimit: LIMITS.noteBytes + 64 * KB, reply: "json",
    params: Type.Object({ id: NoteId }), answer: Type.Object({ revision: Revision, entry: Entry, url: Type.String() }),
  }),
  agentHistory: r({
    method: "GET", url: `${AGENT_BASE}/items/:id/history`, auth: "token", body: "none", reply: "json",
    params: Type.Object({ id: NoteId }), answer: Type.Object({ versions: Type.Array(HistoryEntry) }),
  }),
  agentVersion: r({
    method: "GET", url: `${AGENT_BASE}/items/:id/history/:version`, auth: "token", body: "none", reply: "json",
    params: Type.Object({ id: NoteId, version: Version }), answer: Type.Object({ text: Type.String() }),
  }),
} as const;

export type Routes = typeof routes;
export type RouteName = keyof Routes;

/** The JSON answer of a route. */
export type Answer<N extends RouteName> = Routes[N] extends { answer: infer A extends TSchema } ? Static<A> : never;
/** The JSON body of a route. */
export type JsonBody<N extends RouteName> = Routes[N] extends { json: infer A extends TSchema } ? Static<A> : never;
export type Params<N extends RouteName> = Routes[N] extends { params: infer A extends TSchema } ? Static<A> : Record<string, never>;
export type Query<N extends RouteName> = Routes[N] extends { query: infer A extends TSchema } ? Static<A> : Record<string, never>;

/** The address of a route with its parameters filled in. */
export function urlOf(url: string, params: Record<string, string> = {}): string {
  return url.replace(/:([a-z]+)/g, (_, k: string) => encodeURIComponent(params[k] ?? ""));
}

/** The browser's addresses (9.1): every one is answered with the HTML page. */
export const PAGES = ["/", "/login", "/n/:id", "/n/:id/history", "/d/:id", "/d/:id/history", "/trash", "/fonts", "/styles", "/account"] as const;
