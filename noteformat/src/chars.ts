// Character classes used by the inline passes (SPEC 2 definitions, CommonMark definitions).

/** CommonMark Unicode whitespace: Zs, tab, LF, FF, CR. SPEC 2 uses the same definition. */
export function isWhitespace(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\f" || c === "\r" || /^\p{Zs}$/u.test(c);
}

/** CommonMark 0.31.2 Unicode punctuation: general category P or S. */
export function isPunctuation(c: string): boolean {
  return /^[\p{P}\p{S}]$/u.test(c);
}

/** SPEC 2: a letter or digit is a character in Unicode general category L or N. */
export function isLetterOrDigit(c: string): boolean {
  return /^[\p{L}\p{N}]$/u.test(c);
}

const ASCII_PUNCT = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

export function isAsciiPunct(c: string): boolean {
  return c.length === 1 && ASCII_PUNCT.includes(c);
}

/** The code point (as a string) that ends just before position `i`, or "" at the start. */
export function charBefore(s: string, i: number): string {
  if (i <= 0) return "";
  const lo = s.charCodeAt(i - 1);
  if (lo >= 0xdc00 && lo <= 0xdfff && i >= 2) {
    const hi = s.charCodeAt(i - 2);
    if (hi >= 0xd800 && hi <= 0xdbff) return s.slice(i - 2, i);
  }
  return s[i - 1];
}

/** The code point (as a string) that starts at position `i`, or "" at the end. */
export function charAt(s: string, i: number): string {
  if (i >= s.length) return "";
  const cp = s.codePointAt(i)!;
  return String.fromCodePoint(cp);
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"));
}
