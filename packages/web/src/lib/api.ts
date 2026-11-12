// The browser's API client (SPEC2 6, 9.2), typed from `contract`. Only store actions call it;
// components never call `fetch`. Tests replace it with a fake (`setClient`).

import { routes, urlOf, type Answer, type JsonBody, type RouteName } from "../../../contract/src/index.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: Record<string, unknown>;
  constructor(status: number, code: string, message: string, body: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/** Called on a 401 from any route but login (the session ended). */
export const onUnauthorized: { handler: () => void } = { handler: () => {} };

interface CallOptions {
  params?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
  json?: unknown;
  markdown?: string;
  form?: FormData;
  headers?: Record<string, string>;
}

async function call<N extends RouteName>(name: N, o: CallOptions = {}): Promise<Answer<N>> {
  const d = routes[name];
  let url = urlOf(d.url, o.params);
  const q = Object.entries(o.query ?? {}).filter(([, v]) => v !== undefined && v !== "");
  if (q.length) url += "?" + new URLSearchParams(q.map(([k, v]) => [k, String(v)])).toString();
  const headers: Record<string, string> = { ...o.headers };
  let body: BodyInit | undefined;
  if (o.markdown !== undefined) {
    headers["content-type"] = "text/markdown; charset=utf-8";
    body = o.markdown;
  } else if (o.form) body = o.form;
  else if (o.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(o.json);
  }
  let res: Response;
  try {
    res = await fetch(url, { method: d.method, headers, body, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "offline", "The server could not be reached. Check the connection and try again.");
  }
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    const err = (data.error ?? {}) as { code?: string; message?: string };
    if (res.status === 401 && name !== "login") onUnauthorized.handler();
    throw new ApiError(res.status, err.code ?? "error", err.message ?? `The server answered ${res.status}.`, data);
  }
  return data as Answer<N>;
}

/** Everything the stores ask of the server. */
export interface ApiClient {
  login(username: string, password: string): Promise<Answer<"login">>;
  logout(): Promise<unknown>;
  me(): Promise<Answer<"me">>;
  password(current: string, next: string): Promise<unknown>;
  list(q: { tag?: string; q?: string }): Promise<Answer<"list">>;
  create(title?: string): Promise<Answer<"create">>;
  saveAsNew(text: string, from?: string): Promise<Answer<"create">>;
  read(id: string): Promise<Answer<"read">>;
  save(id: string, text: string, revision: string): Promise<Answer<"save">>;
  trash(id: string): Promise<unknown>;
  history(id: string): Promise<Answer<"history">>;
  version(id: string, version: string): Promise<Answer<"version">>;
  upload(id: string, file: Blob, name: string): Promise<Answer<"upload">>;
  trashList(): Promise<Answer<"trashList">>;
  trashRead(id: string): Promise<Answer<"trashRead">>;
  restore(id: string): Promise<Answer<"restore">>;
  empty(ids: string[]): Promise<Answer<"empty">>;
  styles(): Promise<Answer<"styles">>;
  styleSave(name: string, style: JsonBody<"styleSave">["style"], renameFrom?: string): Promise<Answer<"styleSave">>;
  styleDelete(name: string): Promise<Answer<"styleDelete">>;
  catalogue(q: { q?: string; category?: string; offset?: number }): Promise<Answer<"catalogue">>;
  fonts(): Promise<Answer<"fonts">>;
  fontAdd(slug: string): Promise<Answer<"fontAdd">>;
  fontRemove(slug: string): Promise<Answer<"fontRemove">>;
}

export const httpClient: ApiClient = {
  login: (username, password) => call("login", { json: { username, password } }),
  logout: () => call("logout"),
  me: () => call("me"),
  password: (current, next) => call("password", { json: { current, next } }),
  list: (q) => call("list", { query: q }),
  create: (title) => call("create", { json: title === undefined ? {} : { title } }),
  saveAsNew: (text, from) => call("create", { markdown: text, query: { from } }),
  read: (id) => call("read", { params: { id } }),
  save: (id, text, revision) => call("save", { params: { id }, markdown: text, headers: { "if-match": revision } }),
  trash: (id) => call("trash", { params: { id } }),
  history: (id) => call("history", { params: { id } }),
  version: (id, version) => call("version", { params: { id, version } }),
  upload: (id, file, name) => {
    const form = new FormData();
    form.append("file", file, name);
    return call("upload", { params: { id }, form });
  },
  trashList: () => call("trashList"),
  trashRead: (id) => call("trashRead", { params: { id } }),
  restore: (id) => call("restore", { params: { id } }),
  empty: (ids) => call("empty", { json: { ids } }),
  styles: () => call("styles"),
  styleSave: (name, style, renameFrom) => call("styleSave", { params: { name }, json: renameFrom === undefined ? { style } : { style, renameFrom } }),
  styleDelete: (name) => call("styleDelete", { params: { name } }),
  catalogue: (q) => call("catalogue", { query: q }),
  fonts: () => call("fonts"),
  fontAdd: (slug) => call("fontAdd", { json: { slug } }),
  fontRemove: (slug) => call("fontRemove", { params: { slug } }),
};

let current: ApiClient = httpClient;

export function api(): ApiClient {
  return current;
}

/** For tests: a fake client. */
export function setClient(c: ApiClient): void {
  current = c;
}

/** Asset addresses (no request is made here). */
export const assetUrl = (id: string, file: string, trash = false) => `/api/${trash ? "trash" : "notes"}/${id}/assets/${encodeURIComponent(file)}`;
export const previewUrl = (slug: string) => `/api/fonts/preview/${slug}`;
