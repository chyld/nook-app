// EDITOR-PLAN 7: Note settings change one front matter key and nothing else, built like the id
// writer of DESIGN 3.1: replace the value on the key's last top-level line, or add a line before
// the closing `---`, or add a front matter block; then parse again and check that only that key
// changed. Unknown keys, comments and order are kept.

import { parseNote, type Note } from "../../../noteformat/src/index.ts";
import { splitLines } from "../../../noteformat/src/source.ts";
import { hasBrokenFrontMatter } from "./frontmatter.ts";
import { firstLineEnding } from "./text.ts";

export type SettingKey = "title" | "tags" | "font" | "size" | "spacing";

/** `spacing`: the app's own key (the format keeps keys it does not know). The space between
 *  paragraphs as a multiple of the usual one: a number from 0 to 5 with one decimal at most. */
export const SPACING = /^[0-5](\.\d)?$/;
export const validSpacing = (v: string): boolean => SPACING.test(v) && Number(v) <= 5;

/** A key's valid value: the format's own fields, and `spacing` read from the mapping. */
function fieldOf(n: Note, key: SettingKey): string | string[] | undefined {
  if (key !== "spacing") return n.frontMatter?.fields[key];
  const e = n.frontMatter?.mapping.entries.filter((x) => x.key === "spacing").pop();
  return e && e.value.kind === "scalar" && validSpacing(e.value.value) ? e.value.value : undefined;
}

/** The note's paragraph spacing: 1 when it has none (or one that is not valid). */
export function noteSpacing(text: string): number {
  const v = fieldOf(parseNote(text), "spacing");
  return typeof v === "string" ? Number(v) : 1;
}
export type SettingValue = string | string[] | null;
export type WriteResult = { ok: true; text: string } | { ok: false; reason: string };

const FENCE = /^--- *$/;
const keyLine = (key: string) => new RegExp(`^${key}:(?=[ \\t]|$)`);

/** What a Note settings field shows: the value, and whether the routine can write it. */
export interface SettingView {
  value: string;
  writable: boolean;
  /** Why it is read-only. */
  reason?: string;
}

function lineInfo(text: string) {
  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const lines = splitLines(text, start);
  let close = -1;
  if (lines.length >= 2 && FENCE.test(text.slice(lines[0].start, lines[0].end))) {
    for (let i = 1; i < lines.length; i++) {
      if (FENCE.test(text.slice(lines[i].start, lines[i].end))) {
        close = i;
        break;
      }
    }
  }
  return { start, lines, close };
}

/** The last top-level line of a key, and whether its value goes on below it (a block value). */
function findKey(text: string, key: SettingKey): { index: number; multiLine: boolean } | null {
  const { lines, close } = lineInfo(text);
  if (close < 0) return null;
  for (let i = close - 1; i >= 1; i--) {
    if (!keyLine(key).test(text.slice(lines[i].start, lines[i].end))) continue;
    const next = i + 1 < close ? text.slice(lines[i + 1].start, lines[i + 1].end) : "";
    const value = text.slice(lines[i].start, lines[i].end).slice(key.length + 1).replace(/[ \t]+#.*$/, "").trim();
    return { index: i, multiLine: value === "" && /^[ \t-]/.test(next) || /^[|>]/.test(value) };
  }
  return null;
}

/** A YAML scalar for a value: plain when that reads back as the same string, else quoted. */
function scalar(v: string): string[] {
  const plain = /^[\p{L}\p{N}][\p{L}\p{N} ._\-()\/+']*$/u.test(v) && !/^(true|false|yes|no|null|on|off|~)$/i.test(v) && !/^[-+]?[\d.]+$/.test(v) && !/[ ]$/.test(v);
  const quoted = JSON.stringify(v).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return plain ? [v, quoted] : [quoted];
}

function writes(key: SettingKey, value: string | string[]): string[] {
  if (Array.isArray(value)) {
    const items = value.map((t) => scalar(t));
    return [`[${items.map((x) => x[0]).join(", ")}]`, `[${items.map((x) => x[x.length - 1]).join(", ")}]`];
  }
  // A spacing is a bare number, as a person would write it.
  if (key === "spacing") return [value];
  return scalar(value);
}

const otherEntries = (n: Note, key: string) => JSON.stringify(n.frontMatter?.mapping.entries.filter((e) => e.key !== key) ?? []);

/** Sets (or, with null, removes) one Note settings key. */
export function writeSetting(text: string, key: SettingKey, value: SettingValue): WriteResult {
  if (hasBrokenFrontMatter(text)) return { ok: false, reason: "the front matter does not parse; edit it in Raw" };
  const before = parseNote(text);
  const { start, lines, close } = lineInfo(text);
  const want = value === null || (Array.isArray(value) && value.length === 0) || value === "" ? null : value;
  // `---`, blank lines, `---` at the start is front matter in all but name (DESIGN 3.1).
  const emptyBlock = !before.frontMatter && close >= 1 && lines.slice(1, close).every((l) => text.slice(l.start, l.end).trim() === "");
  const bodyStart = emptyBlock ? lines[close].next : before.bodyRange.start;
  const check = (t: string): string | null => {
    const after = parseNote(t);
    if (after.bom !== before.bom || otherEntries(after, key) !== otherEntries(before, key)) return "other keys would change";
    if (t.slice(after.bodyRange.start) !== text.slice(bodyStart)) return "the note's text would change";
    const got = fieldOf(after, key);
    if (want === null ? got !== undefined && after.frontMatter?.mapping.entries.some((e) => e.key === key) : JSON.stringify(got) !== JSON.stringify(want)) return `this ${key} is not a valid value`;
    return null;
  };
  const found = findKey(text, key);
  if (found?.multiLine) return { ok: false, reason: `the ${key} is written over several lines; edit it in Raw` };
  const eol = close >= 0 ? text.slice(lines[0].end, lines[0].next) || "\n" : firstLineEnding(text, start);

  if (want === null) {
    if (close < 0 || !before.frontMatter?.mapping.entries.some((e) => e.key === key)) return { ok: true, text };
    // Every top-level line of the key goes (an earlier one would otherwise count again).
    let t = text;
    for (let i = close - 1; i >= 1; i--) {
      if (!keyLine(key).test(t.slice(lines[i].start, lines[i].end))) continue;
      const f = findKeyAt(t, key, i);
      if (f) return { ok: false, reason: `the ${key} is written over several lines; edit it in Raw` };
      t = t.slice(0, lines[i].start) + t.slice(lines[i].next);
    }
    // With no key left, `---` and `---` would read as two lines in the note: the block goes.
    const left = lineInfo(t);
    if (left.close >= 1 && left.lines.slice(1, left.close).every((l) => /^[ \t]*(#.*)?$/.test(t.slice(l.start, l.end))) && !parseNote(t).frontMatter?.mapping.entries.length) {
      t = t.slice(0, left.lines[0].start) + t.slice(left.lines[left.close].next);
    }
    const r = check(t);
    return r ? { ok: false, reason: r } : { ok: true, text: t };
  }

  let last = "could not be written";
  for (const v of writes(key, want)) {
    let t: string;
    if (found) {
      const line = text.slice(lines[found.index].start, lines[found.index].end);
      const comment = /[ \t]+#.*$/.exec(line.slice(key.length + 1));
      const tail = comment ? comment[0] : "";
      t = text.slice(0, lines[found.index].start) + `${key}: ${v}${tail}` + text.slice(lines[found.index].end);
    } else if (close >= 0) {
      t = text.slice(0, lines[close].start) + `${key}: ${v}${eol}` + text.slice(lines[close].start);
    } else {
      t = text.slice(0, start) + `---${eol}${key}: ${v}${eol}---${eol}` + text.slice(start);
    }
    const r = check(t);
    if (r === null) return { ok: true, text: t };
    last = r;
  }
  return { ok: false, reason: last };
}

function findKeyAt(text: string, key: SettingKey, i: number): boolean {
  const { lines, close } = lineInfo(text);
  const value = text.slice(lines[i].start, lines[i].end).slice(key.length + 1).replace(/[ \t]+#.*$/, "").trim();
  const next = i + 1 < close ? text.slice(lines[i + 1].start, lines[i + 1].end) : "";
  return (value === "" && /^[ \t-]/.test(next)) || /^[|>]/.test(value);
}

/** The Note settings row's view of its keys. */
export function readSettings(text: string): { broken: boolean; fields: Record<SettingKey, SettingView> } {
  const broken = hasBrokenFrontMatter(text);
  const n = parseNote(text);
  const f = n.frontMatter?.fields ?? {};
  const view = (key: SettingKey, value: string): SettingView => {
    if (broken) return { value, writable: false, reason: "the front matter does not parse" };
    const found = findKey(text, key);
    if (found?.multiLine) return { value, writable: false, reason: "written over several lines" };
    // A value present but not valid (so not in the fields) is shown as written, read-only.
    const raw = n.frontMatter?.mapping.entries.filter((e) => e.key === key).pop();
    if (raw && fieldOf(n, key) === undefined) return { value: "", writable: false, reason: "not a value the app understands" };
    return { value, writable: true };
  };
  return {
    broken,
    fields: {
      title: view("title", f.title ?? ""),
      tags: view("tags", (f.tags ?? []).join(", ")),
      font: view("font", f.font ?? ""),
      size: view("size", f.size ?? ""),
      spacing: view("spacing", (fieldOf(n, "spacing") as string | undefined) ?? ""),
    },
  };
}
