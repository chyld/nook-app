// `window.__notes.intent(i)` (SPEC2 11) is given intents by tests that know only the spec's
// notation (7.3): `insertText(text)`, `setMark(change)`, `setBlock(kind)`... This turns the
// likely ways of writing one into the `Intent` shape, or null.

import type { Intent } from "./types.ts";

const NO_ARGS = new Set(["deleteBackward", "deleteForward", "deleteWordBackward", "deleteWordForward", "cut", "enter", "lineBreak", "shortcut", "lineAfterTable"]);

export function normalizeIntent(i: unknown): Intent | null {
  if (typeof i === "string") return NO_ARGS.has(i) ? ({ type: i } as Intent) : null;
  if (!i || typeof i !== "object") return null;
  const o = { ...(i as Record<string, unknown>) };
  const type = (o.type ?? o.intent ?? o.name) as string | undefined;
  if (typeof type !== "string") return null;
  const arg = o.arg ?? o.value;
  switch (type) {
    case "insertText":
      return typeof (o.text ?? arg) === "string" ? { type, text: (o.text ?? arg) as string } : null;
    case "paste": {
      const p = (o.plain !== undefined ? o : typeof arg === "object" && arg ? arg : o) as Record<string, unknown>;
      return { type, plain: String(p.plain ?? p.text ?? ""), markdown: (p.markdown as string | undefined) ?? null };
    }
    case "setMark": {
      const change = (o.change ?? (typeof arg === "object" ? arg : undefined) ?? (o.kind ? { ...o, type: undefined } : undefined)) as Record<string, unknown> | undefined;
      if (!change || typeof change.kind !== "string") return null;
      const c = { ...change };
      delete c.type;
      return { type, change: c as never };
    }
    case "applyStyle":
      return { type, style: (o.style ?? arg) as never };
    case "setBlock":
    case "setList":
      return typeof (o.kind ?? arg) === "string" ? ({ type, kind: (o.kind ?? arg) as never } as Intent) : null;
    case "setLink":
      return { type, href: ((o.href ?? o.url ?? arg) as string | null | undefined) ?? null };
    case "insertBlock":
      return { type, what: (o.what ?? o.kind ?? o.block ?? arg) as "table" | "rule" };
    case "insertPhoto":
      return { type, file: String(o.file ?? arg) };
    case "setImageWidth":
      return { type, at: Number(o.at), value: Number(o.value ?? o.width) };
    case "toggleTask":
      return { type, at: Number(o.at) };
    case "tableEdit":
      return { type, at: Number(o.at), op: o.op as never, ...(o.pending ? { pending: o.pending as never } : {}) };
    case "setMeta":
      return { type, key: o.key as never, value: (o.value ?? null) as never };
    default:
      return NO_ARGS.has(type) ? ({ type } as Intent) : null;
  }
}
