// CommonMark inline constructs that the scan pass (SPEC 5.1) recognises exactly as CommonMark
// 0.31.2 does: code spans, autolinks, link destinations, link titles and link labels.

import { isAsciiPunct } from "../chars.ts";
import { unescapeString } from "../entities.ts";

/**
 * A code span starting at the backtick run at `i`: the run, then the next backtick run of the
 * same length. Returns null if there is no closing run (the opening run is then literal).
 */
export function matchCodeSpan(t: string, i: number): { end: number; value: string; runEnd: number } | null {
  const n = t.length;
  let m = i;
  while (m < n && t[m] === "`") m++;
  const len = m - i;
  let k = m;
  while (k < n) {
    if (t[k] === "`") {
      let e = k;
      while (e < n && t[e] === "`") e++;
      if (e - k === len) {
        let value = t.slice(m, k).replace(/\n/g, " ");
        if (value.length >= 2 && value[0] === " " && value[value.length - 1] === " " && /[^ ]/.test(value)) {
          value = value.slice(1, -1);
        }
        return { end: e, value, runEnd: m };
      }
      k = e;
    } else {
      k++;
    }
  }
  return null;
}

/** Ends the run of backticks at `i` (used when no code span starts there). */
export function backtickRunEnd(t: string, i: number): number {
  let m = i;
  while (m < t.length && t[m] === "`") m++;
  return m;
}

const URI_AUTOLINK = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\x00-\x20\x7f]*)>/y;
const EMAIL_AUTOLINK =
  /<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/y;

/** A CommonMark autolink (URI or email) starting at the `<` at `i`. */
export function matchAutolink(t: string, i: number): { end: number; url: string; email: boolean } | null {
  URI_AUTOLINK.lastIndex = i;
  let m = URI_AUTOLINK.exec(t);
  if (m) return { end: i + m[0].length, url: m[1], email: false };
  EMAIL_AUTOLINK.lastIndex = i;
  m = EMAIL_AUTOLINK.exec(t);
  if (m) return { end: i + m[0].length, url: m[1], email: true };
  return null;
}

/** Spaces or tabs, including up to one line ending. */
export function skipSpnl(t: string, q: number): number {
  while (q < t.length && (t[q] === " " || t[q] === "\t")) q++;
  if (t[q] === "\n") {
    q++;
    while (q < t.length && (t[q] === " " || t[q] === "\t")) q++;
  }
  return q;
}

/** A link destination at `q`, in angle brackets or raw with balanced parentheses. */
export function parseLinkDestination(t: string, q: number): { value: string; end: number } | null {
  const n = t.length;
  if (t[q] === "<") {
    let k = q + 1;
    while (k < n) {
      const c = t[k];
      if (c === ">") return { value: unescapeString(t.slice(q + 1, k)), end: k + 1 };
      if (c === "\n" || c === "<") return null;
      if (c === "\\" && k + 1 < n && isAsciiPunct(t[k + 1])) k += 2;
      else k++;
    }
    return null;
  }
  let k = q;
  let depth = 0;
  while (k < n) {
    const c = t[k];
    const code = t.charCodeAt(k);
    if (c === "\\" && k + 1 < n && isAsciiPunct(t[k + 1])) {
      k += 2;
      continue;
    }
    if (c === "(") {
      depth++;
      if (depth > 32) return null;
    } else if (c === ")") {
      if (depth === 0) break;
      depth--;
    } else if (code <= 0x20 || code === 0x7f) {
      break;
    }
    k++;
  }
  if (k === q && t[k] !== ")") return null;
  if (depth !== 0) return null;
  return { value: unescapeString(t.slice(q, k)), end: k };
}

/** A link title at `q`: "…", '…' or (…). */
export function parseLinkTitle(t: string, q: number): { value: string; end: number } | null {
  const open = t[q];
  if (open !== '"' && open !== "'" && open !== "(") return null;
  const close = open === "(" ? ")" : open;
  let k = q + 1;
  while (k < t.length) {
    const c = t[k];
    if (c === "\\" && k + 1 < t.length) {
      k += 2;
      continue;
    }
    if (c === close) return { value: unescapeString(t.slice(q + 1, k)), end: k + 1 };
    if (open === "(" && c === "(") return null;
    k++;
  }
  return null;
}

/**
 * The length of a link label `[…]` at `p` (brackets included), or 0. A label holds at most 999
 * characters and no unescaped brackets.
 */
export function linkLabelLength(t: string, p: number): number {
  if (t[p] !== "[") return 0;
  let k = p + 1;
  while (k < t.length) {
    const c = t[k];
    if (c === "\\" && k + 1 < t.length) {
      k += 2;
      continue;
    }
    if (c === "[") return 0;
    if (c === "]") return k - (p + 1) > 999 ? 0 : k - p + 1;
    k++;
  }
  return 0;
}
