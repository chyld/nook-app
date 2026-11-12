// CSS for validated attributes (SPEC 5.3), following the HTML contract of the brief: one
// declaration per valid attribute in the order color, bg, font, size, underline, joined by "; ".

import { NAMED_SIZES } from "./attributes.ts";
import type { FrontMatterFields, ResolvedStyle } from "./types.ts";

/**
 * Heading sizes as multiples of the note's size (EDITOR-PLAN 4): 24, 18, 14, 12, 11 and 10 points
 * in a note of the normal 12pt. The fallback when the theme does not define --note-hN-size.
 */
export const HEADING_FACTORS = [2, 1.5, 1.1667, 1, 0.9167, 0.8333];
const HEADING_SIZES = HEADING_FACTORS.map((f) => `${f}em`);
/** The theme's normal text size, in points (EDITOR-PLAN 4). */
export const BODY_PT = 12;

export function cssColor(v: string): string {
  return v.startsWith("#") ? v : `var(--note-${v})`;
}

export function cssBg(v: string): string {
  return v === "highlight" ? "var(--note-highlight)" : cssColor(v);
}

/** A CSS string in single quotes. */
function cssString(s: string): string {
  let out = "'";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === "'" || ch === "\\") out += "\\" + ch;
    else if (cp < 0x20 || cp === 0x7f) out += "\\" + cp.toString(16) + " ";
    else out += ch;
  }
  return out + "'";
}

export function cssFont(v: string): string {
  if (v === "serif" || v === "sans" || v === "mono") return `var(--note-font-${v})`;
  return cssString(v);
}

/**
 * A size on a span or a paragraph: a named size is a factor of the surrounding size, so `em` is
 * right. On a heading's block attribute line the base is the heading's own size, while `em` in
 * font-size refers to the parent's size, so the heading size is multiplied explicitly.
 */
export function cssSize(v: string, headingLevel?: number): string {
  if (!Object.hasOwn(NAMED_SIZES, v)) return v; // pixels or points, as written
  const factor = NAMED_SIZES[v];
  if (headingLevel === undefined) return `${factor}em`;
  return `calc(var(--note-h${headingLevel}-size, ${HEADING_SIZES[headingLevel - 1]}) * ${factor})`;
}

/** The style declarations of a span, paragraph or heading, in the fixed order. */
export function styleDeclarations(style: ResolvedStyle, headingLevel?: number): string[] {
  const out: string[] = [];
  if (style.color !== undefined) out.push(`color: ${cssColor(style.color)}`);
  if (style.bg !== undefined) out.push(`background-color: ${cssBg(style.bg)}`);
  if (style.font !== undefined) out.push(`font-family: ${cssFont(style.font)}`);
  if (style.size !== undefined) out.push(`font-size: ${cssSize(style.size, headingLevel)}`);
  if (style.underline !== undefined) out.push(`text-decoration: ${style.underline === "yes" ? "underline" : "none"}`);
  return out;
}

/**
 * The style of the note's body from its front matter (SPEC 3): `font`, and `size`, where a
 * named size multiplies the theme's body size (--note-body-size).
 */
export function bodyStyle(fields: Pick<FrontMatterFields, "font" | "size">): string {
  const out: string[] = [];
  if (fields.font !== undefined) {
    const lower = fields.font.toLowerCase();
    out.push(`font-family: ${cssFont(lower === "serif" || lower === "sans" || lower === "mono" ? lower : fields.font)}`);
  }
  if (fields.size !== undefined) {
    const lower = fields.size.toLowerCase();
    if (Object.hasOwn(NAMED_SIZES, lower)) out.push(`font-size: calc(var(--note-body-size, 1rem) * ${NAMED_SIZES[lower]})`);
    else out.push(`font-size: ${fields.size}`);
  }
  return out.join("; ");
}
