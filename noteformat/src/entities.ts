// CommonMark entity and numeric character references, and backslash escapes in strings such
// as link destinations, titles and info strings.

import MarkdownIt from "markdown-it";
import { isAsciiPunct } from "./chars.ts";

const ENTITY = /&(?:#[xX]([0-9a-fA-F]{1,6})|#([0-9]{1,7})|([A-Za-z][A-Za-z0-9]{1,31}));/y;

const unescapeAll = new MarkdownIt().utils.unescapeAll;

/**
 * If an entity or numeric character reference starts at `pos`, returns its decoded text and
 * length. Named references are looked up in the HTML5 table that markdown-it carries.
 */
export function matchEntity(s: string, pos: number): { text: string; length: number } | null {
  ENTITY.lastIndex = pos;
  const m = ENTITY.exec(s);
  if (!m) return null;
  if (m[1] !== undefined || m[2] !== undefined) {
    const code = m[1] !== undefined ? parseInt(m[1], 16) : parseInt(m[2], 10);
    // CommonMark: invalid code points and U+0000 become U+FFFD.
    const ok = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
    return { text: String.fromCodePoint(ok ? code : 0xfffd), length: m[0].length };
  }
  const decoded = unescapeAll(m[0]);
  if (decoded === m[0]) return null;
  return { text: decoded, length: m[0].length };
}

/** Resolves backslash escapes of ASCII punctuation and entity references in `s`. */
export function unescapeString(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length && isAsciiPunct(s[i + 1])) {
      out += s[i + 1];
      i += 2;
      continue;
    }
    if (c === "&") {
      const e = matchEntity(s, i);
      if (e) {
        out += e.text;
        i += e.length;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}
