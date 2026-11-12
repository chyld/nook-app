// A table cell edited as formatted text in rich mode: what is on the screen (runs of text, each
// with its style) is written as the cell's Markdown. The Markdown is built with the checked
// styling routine and then read back: it must show the same text in the same styles.

import { applyStyle, type Change } from "./apply.ts";
import { buildModel } from "./model.ts";

export interface CellStyle {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  underline: boolean;
  code: boolean;
  color: string | null;
  bg: string | null;
  font: string | null;
  /** A size of its own, in points; null for the size of the text around it. */
  size: number | null;
  link: string | null;
}

export interface CellRun {
  text: string;
  style: CellStyle;
}

export const PLAIN: CellStyle = { bold: false, italic: false, strike: false, underline: false, code: false, color: null, bg: null, font: null, size: null, link: null };

export type CellResult = { ok: true; text: string } | { ok: false; reason: string };

// The cell's text is styled as a paragraph of its own would be, with a word on each side so
// that a style is written inside the line, never as a line under it.
const PRE = "a ";
const POST = " a";

type Ch = ReturnType<typeof buildModel>["chars"][number];

/** The visible characters of the cell inside `a … a`, or null if the frame is not intact. */
function inner(doc: string): Ch[] | null {
  const chars = buildModel(doc).chars;
  if (chars.length < 4) return chars.length === 3 ? [] : null;
  const shown = chars.map((c) => c.ch).join("");
  if (!shown.startsWith(PRE) || !shown.endsWith(POST)) return null;
  return chars.slice(2, -2);
}

function plainStyle(c: Ch, base: Ch): boolean {
  const s = c.style;
  return !s.bold && !s.italic && !s.strike && !s.underline && !s.code && !s.color && !s.bg && !s.font && s.link === null && Math.abs(s.size - base.style.size) < 0.06;
}

/** Plain text as Markdown that shows exactly that text: as it is if that works, else escaped. */
function literal(plain: string): string | null {
  const tries = [plain, plain.replace(/[\\`*_[\]{}<>~=+&]/g, "\\$&"), plain.replace(/[!-/:-@[-`{-~]/g, "\\$&")];
  for (const t of tries) {
    const doc = PRE + t + POST;
    if (/[\r\n]/.test(doc)) return null;
    const chars = inner(doc);
    if (!chars || chars.map((c) => c.ch).join("") !== plain) continue;
    const base = buildModel(doc).chars[0];
    // A web address shows as a link by itself; that is what it would do when typed, too.
    if (chars.every((c) => plainStyle(c, base) || (c.style.link !== null && /^(https?:\/\/|mailto:)/i.test(c.style.link) && plainStyle({ ...c, style: { ...c.style, link: null } } as Ch, base)))) return doc;
  }
  return null;
}

/** The Markdown of a cell that shows `runs`. An empty cell is the empty string. */
export function cellMarkdown(runs: CellRun[]): CellResult {
  // One style per character; a cell's text has no spaces at its ends.
  let per: { ch: string; style: CellStyle }[] = [];
  for (const r of runs) for (const ch of r.text.replace(/ /g, " ").replace(/[\r\n\t]+/g, " ")) per.push({ ch, style: r.style });
  while (per.length && per[0].ch === " ") per = per.slice(1);
  while (per.length && per[per.length - 1].ch === " ") per = per.slice(0, -1);
  if (per.length === 0) return { ok: true, text: "" };
  const plain = per.map((p) => p.ch).join("");
  let doc = literal(plain);
  if (doc === null) return { ok: false, reason: "this text cannot be written in a table cell; use Edit as text" };

  const apply = (from: number, to: number, change: Change): boolean => {
    const chars = inner(doc!);
    if (!chars || chars.length !== per.length) return false;
    const r = applyStyle(doc!, chars[from].start, chars[to - 1].end, change);
    if (!r.ok) return false;
    doc = r.text;
    return true;
  };
  // Each property in turn, over each stretch of characters that share its value.
  const props: [keyof CellStyle, (v: never) => Change][] = [
    ["code", () => ({ kind: "code", on: true })],
    ["link", (v: string) => ({ kind: "link", url: v })],
    ["bold", () => ({ kind: "bold", on: true })],
    ["italic", () => ({ kind: "italic", on: true })],
    ["strike", () => ({ kind: "strike", on: true })],
    ["underline", () => ({ kind: "underline", on: true })],
    ["color", (v: string) => ({ kind: "color", value: v })],
    ["bg", (v: string) => ({ kind: "bg", value: v })],
    ["font", (v: string) => ({ kind: "font", value: v })],
    ["size", (v: number) => ({ kind: "size", pt: v })],
  ] as [keyof CellStyle, (v: never) => Change][];
  for (const [key, change] of props) {
    let i = 0;
    while (i < per.length) {
      const v = per[i].style[key];
      let j = i + 1;
      while (j < per.length && per[j].style[key] === v) j++;
      if (v !== false && v !== null) {
        // Spaces at the ends of a stretch are left out: `** bold**` is not bold.
        let a = i;
        let b = j;
        while (a < b && per[a].ch === " ") a++;
        while (b > a && per[b - 1].ch === " ") b--;
        if (b > a && !apply(a, b, change(v as never))) return { ok: false, reason: "this formatting cannot be written in a table cell; use Edit as text" };
      }
      i = j;
    }
  }

  // Read back: the same text, in the same styles (a space may differ: it shows no style).
  const chars = inner(doc);
  const base = buildModel(doc).chars[0];
  if (!chars || chars.length !== per.length || !doc.startsWith(PRE) || !doc.endsWith(POST) || /[\r\n]/.test(doc)) return { ok: false, reason: "this text cannot be written in a table cell; use Edit as text" };
  for (let k = 0; k < per.length; k++) {
    const want = per[k].style;
    const got = chars[k].style;
    if (chars[k].ch !== per[k].ch) return { ok: false, reason: "this text cannot be written in a table cell; use Edit as text" };
    if (per[k].ch === " ") continue;
    const sizeOk = want.size === null ? Math.abs(got.size - base.style.size) < 0.06 : Math.abs(got.size - want.size) < 0.06;
    const linkOk = got.link === want.link || (want.link === null && got.link !== null && /^(https?:\/\/|mailto:)/i.test(got.link));
    if (got.bold !== want.bold || got.italic !== want.italic || got.strike !== want.strike || got.underline !== want.underline || got.code !== want.code || (got.color ?? null) !== want.color || (got.bg ?? null) !== want.bg || (got.font ?? null) !== want.font || !sizeOk || !linkOk) {
      return { ok: false, reason: "this formatting cannot be written in a table cell; use Edit as text" };
    }
  }
  return { ok: true, text: doc.slice(PRE.length, doc.length - POST.length) };
}

/**
 * A toolbar style on part of a cell's Markdown: `from`..`to` count the characters as shown.
 * Toggles (bold and the like) turn on if any of the characters lacks the style.
 */
export function styleCellText(source: string, from: number, to: number, change: Change): CellResult & { from?: number; to?: number } {
  let doc = PRE + source + POST;
  const chars = inner(doc);
  if (!chars || /[\r\n]/.test(doc)) return { ok: false, reason: "this cell cannot be styled here; use Edit as text" };
  from = Math.max(0, Math.min(from, chars.length));
  to = Math.max(from, Math.min(to, chars.length));
  if (to <= from) return { ok: false, reason: "there is no text to style" };
  if ("on" in change) {
    const kind = change.kind;
    change = { ...change, on: !chars.slice(from, to).every((c) => c.style[kind]) } as Change;
  }
  const r = applyStyle(doc, chars[from].start, chars[to - 1].end, change);
  if (!r.ok) return { ok: false, reason: r.reason };
  doc = r.text;
  const after = inner(doc);
  if (!after || after.length !== chars.length || !doc.startsWith(PRE) || !doc.endsWith(POST) || /[\r\n]/.test(doc)) return { ok: false, reason: "this style cannot be written in a table cell" };
  return { ok: true, text: doc.slice(PRE.length, doc.length - POST.length), from, to };
}

/** The visible characters of a cell's Markdown (SPEC2 7.2: `describeCell` reads them). */
export function cellChars(source: string): Ch[] | null {
  return inner(PRE + source + POST);
}

/** The number of characters a cell's Markdown shows. */
export function shownLength(source: string): number {
  return inner(PRE + source + POST)?.length ?? 0;
}
