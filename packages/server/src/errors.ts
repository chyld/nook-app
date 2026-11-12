// An error that becomes an HTTP answer (SPEC2 6): `{ error: { code, message } }`, with any
// extra fields (a 409 on save adds `current`).

const CODES: Record<number, string> = {
  400: "bad-request",
  401: "no-session",
  403: "wrong-origin",
  404: "not-found",
  409: "conflict",
  410: "trashed",
  413: "too-large",
  415: "unsupported-type",
  422: "refused",
  429: "busy",
  500: "server",
  502: "upstream",
  503: "unavailable",
  504: "timeout",
};

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, message: string, extra: Record<string, unknown> = {}, code = CODES[status] ?? "error") {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  get body(): Record<string, unknown> {
    return { error: { code: this.code, message: this.message }, ...this.extra };
  }
}

export function errorBody(status: number, message: string): Record<string, unknown> {
  return { error: { code: CODES[status] ?? "error", message } };
}
