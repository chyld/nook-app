// SPEC 3: recognising front matter, and reading its known keys.

import { splitLines } from "./source.ts";
import { parseYaml, YamlError } from "./yaml.ts";
import { validFont, validSize } from "./attributes.ts";
import type { FrontMatter, FrontMatterFields, YamlMapping, YamlNode } from "./types.ts";

/** `---`, optionally followed by spaces (U+0020). */
const FENCE = /^--- *$/;

/**
 * Finds the front matter of a file whose body text starts at `start` (after any byte order
 * mark). Returns null unless all three conditions of SPEC 3 hold.
 */
export function readFrontMatter(source: string, start: number): FrontMatter | null {
  const lines = splitLines(source, start);
  if (lines.length < 2) return null;
  const first = lines[0];
  // 1. The first line of the file is `---`, optionally followed by spaces.
  if (!FENCE.test(source.slice(first.start, first.end))) return null;
  // 2. A later line is `---`; the first such line is the closing line.
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (FENCE.test(source.slice(lines[i].start, lines[i].end))) {
      close = i;
      break;
    }
  }
  if (close < 0) return null;
  // 3. The lines between them are a YAML mapping with at least one key.
  const inner = lines.slice(1, close);
  const yamlText = inner.map((l) => source.slice(l.start, l.end)).join("\n");
  let node: YamlNode | null;
  try {
    node = parseYaml(yamlText);
  } catch (e) {
    if (e instanceof YamlError) return null;
    throw e;
  }
  if (!node || node.kind !== "map" || node.entries.length === 0) return null;
  const contentStart = lines[1].start;
  const contentEnd = close > 1 ? lines[close - 1].end : contentStart;
  return {
    type: "frontMatter",
    range: { start: first.start, end: lines[close].next },
    contentRange: { start: contentStart, end: contentEnd },
    mapping: node,
    fields: readFields(node),
  };
}

function scalar(node: YamlNode): string | null {
  // SPEC 3: the value of a scalar is its text as written, without quotes. An empty value
  // (`title:`) is treated as invalid; see SPEC-ISSUES.md.
  if (node.kind !== "scalar" || node.value === "") return null;
  return node.value;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?(?:Z|[+-](\d{2})(?::?(\d{2}))?)?$/;

/**
 * SPEC 3 `created` and `updated`: an ISO 8601 date or date-time. Accepted: the extended
 * calendar date `YYYY-MM-DD`, optionally followed by `T`, `hh:mm`, optional `:ss` with an
 * optional fraction, and an optional zone `Z`, `±hh`, `±hhmm` or `±hh:mm`.
 */
export function isIsoDateOrDateTime(v: string): boolean {
  const m = DATE.exec(v) ?? DATE_TIME.exec(v);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > days[month - 1]) return false;
  if (m[4] !== undefined) {
    if (Number(m[4]) > 23 || Number(m[5]) > 59) return false;
    if (m[6] !== undefined && Number(m[6]) > 60) return false;
    if (m[7] !== undefined && Number(m[7]) > 23) return false;
    if (m[8] !== undefined && Number(m[8]) > 59) return false;
  }
  return true;
}

/** SPEC 3 `id`: exactly 12 characters, each one of `a` to `z` or `2` to `7`. */
export function isValidId(v: string): boolean {
  return /^[a-z2-7]{12}(?:[a-z2-7]{12})?$/.test(v);
}

/** Reads the keys of the SPEC 3 table. The last occurrence of a key is the one used. */
export function readFields(mapping: YamlMapping): FrontMatterFields {
  const last = new Map<string, YamlNode>();
  for (const e of mapping.entries) last.set(e.key, e.value);
  const fields: FrontMatterFields = {};
  const get = (k: string) => last.get(k);

  // SPEC 1.1: `id` is exactly 12 characters from `a-z` and `2-7`.
  const id = get("id");
  if (id) {
    const v = scalar(id);
    if (v !== null && isValidId(v)) fields.id = v;
  }
  const title = get("title");
  if (title) {
    const v = scalar(title);
    if (v !== null) fields.title = v;
  }
  const tags = get("tags");
  if (tags && tags.kind === "seq" && tags.items.every((n) => n.kind === "scalar")) {
    // An empty scalar is not a value (see scalar()), so an empty tag is dropped.
    fields.tags = tags.items.map((n) => (n.kind === "scalar" ? n.value : "")).filter((v) => v !== "");
  }
  for (const key of ["created", "updated"] as const) {
    const n = get(key);
    if (n) {
      const v = scalar(n);
      if (v !== null && isIsoDateOrDateTime(v)) fields[key] = v;
    }
  }
  const font = get("font");
  if (font) {
    const v = scalar(font);
    if (v !== null && validFont(v) !== null) fields.font = v;
  }
  const size = get("size");
  if (size) {
    const v = scalar(size);
    if (v !== null && validSize(v) !== null) fields.size = v;
  }
  const theme = get("theme");
  if (theme) {
    const v = scalar(theme);
    if (v !== null) fields.theme = v;
  }
  return fields;
}
