// Facts about a note that the header, the toolbar and the server share (SPEC2 4.2, 4.3, 7.6):
// its title, cleaning a title or a tag before it is written, the note's own size and font,
// and the bytes of a note as the editor holds them (4.4).

import { HEADING_FACTORS, noteMeta, parseNote } from "../../../noteformat/src/index.ts";
import { lineEndings, toLf } from "./text.ts";
import type { Model } from "./style/model.ts";

export const TITLE_MAX = 300;
export const TAG_MAX = 30;

/** 4.2: the front matter `title`, then the first level-1 heading, then `Untitled`. */
export function noteTitle(text: string): string {
  const t = noteMeta(parseNote(text)).title.trim();
  return t === "" ? "Untitled" : t;
}

/** 4.3: line breaks and control characters become spaces, runs of spaces are joined, and the
 *  title is trimmed and cut to 300 characters. */
export function cleanTitle(s: string): string {
  const flat = s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/gu, " ").trim();
  return [...flat].slice(0, TITLE_MAX).join("").trim();
}

/** 7.6: a tag the app writes is lower-case `a-z`, at most 30 characters. Capitals become
 *  lower case and anything else is dropped (version 1's tag box). Empty when nothing is left. */
export function cleanTag(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, "").slice(0, TAG_MAX);
}

export const isCleanTag = (s: string): boolean => /^[a-z]{1,30}$/.test(s);

/** The note's own size in points (the format's rule), and a heading's natural size. */
export function noteSizeOf(m: Model): number {
  return m.runs.noteSize;
}

/** The size the block at a position gives: a heading's own size, else the note's (7.6). */
export function naturalSize(m: Model, block: { kind: string; level?: number } | null): number {
  if (block && block.kind === "heading") return m.runs.noteSize * HEADING_FACTORS[(block.level ?? 1) - 1];
  return m.runs.noteSize;
}

/** The note's font: its front matter `font`, or null for the theme's (serif). */
export function noteFontOf(m: Model): string | null {
  return m.note.frontMatter?.fields.font ?? null;
}

// --- bytes (4.4) ------------------------------------------------------------------------------

export type Eol = "\n" | "\r\n";

/** A note's text as decoded from its bytes, ready for the editor: LF endings, no byte order mark. */
export function load(text: string): { text: string; eol: Eol; bom: boolean; mixed: boolean } {
  const bom = text.charCodeAt(0) === 0xfeff;
  const body = bom ? text.slice(1) : text;
  const kind = lineEndings(body);
  return { text: kind === "lf" || kind === "none" ? body : toLf(body), eol: kind === "crlf" ? "\r\n" : "\n", bom, mixed: kind === "mixed" };
}

/** The bytes' text again, for a save, a draft and the `dirty` comparison. */
export function serialize(text: string, eol: Eol, bom: boolean): string {
  const body = eol === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
  return (bom ? "\ufeff" : "") + body;
}
