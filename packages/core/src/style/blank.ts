// The one rule for white space (SPEC-NOTES, "The kept space"). Markdown's own white space is the
// space, the tab and the line ends: a paragraph drops them at its ends, and a line holding only
// them is blank. U+00A0, which a space typed where Markdown would drop it becomes (change 15), is
// content: Markdown keeps it and shows it, so no code counts it as blank or drops it. To the
// person it is a space: it separates words, a search matches it with a typed space, and a
// plain-text copy gives an ordinary space.

/** Markdown's white space: a character a paragraph drops at its ends. */
export function isMdSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

/** A text of Markdown's white space only (a blank line, or nothing). */
export function isBlank(s: string): boolean {
  return /^[ \t\r\n]*$/.test(s);
}

/** The kept space, as the person reads it: an ordinary space (search, plain-text copy). */
export function plainSpaces(s: string): string {
  return s.replace(/\u00a0/g, " ");
}
