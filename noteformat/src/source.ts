// SPEC 2: byte order mark, line endings, and the mapping between the text the parsers work on
// and offsets in the original source.

import type { Range } from "./types.ts";

export interface SourceLine {
  /** Offset of the first character of the line. */
  start: number;
  /** Offset just after the last character of the line's content (before the line ending). */
  end: number;
  /** Offset just after the line ending (equal to `end` on a last line without one). */
  next: number;
}

/**
 * Splits `source[from, to)` into lines. A line ending is LF, CRLF or a lone CR (SPEC 2:
 * "A lone CR also ends a line, as in CommonMark"). A line ending is never part of a
 * line's content. A final line ending does not start a further, empty line.
 */
export function splitLines(source: string, from = 0, to = source.length): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = from;
  let i = from;
  while (i < to) {
    const c = source.charCodeAt(i);
    if (c === 0x0a || c === 0x0d) {
      const next = c === 0x0d && i + 1 < to && source.charCodeAt(i + 1) === 0x0a ? i + 2 : i + 1;
      lines.push({ start, end: i, next });
      start = next;
      i = next;
    } else {
      i++;
    }
  }
  if (start < to) lines.push({ start, end: to, next: to });
  return lines;
}

/**
 * The body text handed to the block parser: line endings normalised to LF and NUL replaced by
 * U+FFFD (as CommonMark requires), with a map from every position back to the source.
 */
export interface BodyText {
  source: string;
  text: string;
  /** toSource[i] is the source offset of text[i]; toSource[text.length] is the body's end. */
  toSource: Int32Array;
  /** Lines of `text`: start and end (exclusive, before "\n") in text positions. */
  lines: { start: number; end: number }[];
}

export function makeBodyText(source: string, from: number, to: number): BodyText {
  let text = "";
  const map: number[] = [];
  let i = from;
  let chunkStart = from;
  const flush = (end: number) => {
    if (end > chunkStart) {
      text += source.slice(chunkStart, end);
      for (let k = chunkStart; k < end; k++) map.push(k);
    }
  };
  while (i < to) {
    const c = source.charCodeAt(i);
    if (c === 0x0d) {
      flush(i);
      text += "\n";
      map.push(i);
      i += i + 1 < to && source.charCodeAt(i + 1) === 0x0a ? 2 : 1;
      chunkStart = i;
    } else if (c === 0) {
      flush(i);
      text += "�";
      map.push(i);
      i++;
      chunkStart = i;
    } else {
      i++;
    }
  }
  flush(to);
  map.push(to);
  const lines: { start: number; end: number }[] = [];
  let s = 0;
  for (let k = 0; k < text.length; k++) {
    if (text.charCodeAt(k) === 0x0a) {
      lines.push({ start: s, end: k });
      s = k + 1;
    }
  }
  if (s < text.length) lines.push({ start: s, end: text.length });
  return { source, text, toSource: Int32Array.from(map), lines };
}

/** The source offset just after the character at text position `i`. */
export function sourceAfter(body: { source: string; toSource: Int32Array }, i: number): number {
  const j = body.toSource[i];
  const src = body.source;
  if (src.charCodeAt(j) === 0x0d && src.charCodeAt(j + 1) === 0x0a) return j + 2;
  return j + 1;
}

/** Converts a range of text positions [a, b) to a source range. */
export function sourceRange(body: { source: string; toSource: Int32Array }, a: number, b: number): Range {
  const start = body.toSource[a];
  return { start, end: b > a ? sourceAfter(body, b - 1) : start };
}

/** CommonMark: a line is blank when it holds only spaces and tabs. */
export function isBlankText(s: string): boolean {
  return /^[ \t]*$/.test(s);
}
