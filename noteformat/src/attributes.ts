// SPEC 5.3: the syntax of an attribute list, and which attributes are valid where.

import type { AttributePlace, ResolvedStyle } from "./types.ts";

/** An attribute as found by the syntax, with positions in the string that was scanned. */
export interface RawAttribute {
  key: string;
  value: string;
  quoted: boolean;
  start: number;
  end: number;
}

export interface RawAttributeList {
  attributes: RawAttribute[];
  /** Position of the `{`. */
  start: number;
  /** Position just after the `}`. */
  end: number;
}

const SPACE = 0x20;

function isKeyChar(c: number): boolean {
  return c >= 0x61 && c <= 0x7a; // a-z
}

/** bare = 1*( ALPHA / DIGIT / "#" / "%" / "." / "-" / "_" ), ASCII only. */
function isBareChar(c: number): boolean {
  return (
    (c >= 0x41 && c <= 0x5a) ||
    (c >= 0x61 && c <= 0x7a) ||
    (c >= 0x30 && c <= 0x39) ||
    c === 0x23 || // #
    c === 0x25 || // %
    c === 0x2e || // .
    c === 0x2d || // -
    c === 0x5f // _
  );
}

/**
 * Parses an attribute list that starts with the `{` at `pos` (SPEC 5.3 and the grammar of
 * SPEC 8). Returns null when the text there is not an attribute list. CommonMark backslash
 * escapes play no part: only the quoted-string escapes `\"` and `\\` exist.
 */
export function parseAttributeList(text: string, pos: number, end = text.length): RawAttributeList | null {
  if (text.charCodeAt(pos) !== 0x7b) return null; // {
  let p = pos + 1;
  while (p < end && text.charCodeAt(p) === SPACE) p++;
  const attributes: RawAttribute[] = [];
  for (;;) {
    // attribute = key "=" value
    const keyStart = p;
    while (p < end && isKeyChar(text.charCodeAt(p))) p++;
    if (p === keyStart) return null;
    const key = text.slice(keyStart, p);
    if (p >= end || text.charCodeAt(p) !== 0x3d) return null; // =
    p++;
    let value = "";
    let quoted = false;
    if (p < end && text.charCodeAt(p) === 0x22) {
      // quoted = DQUOTE *( qchar / escape / lone ) DQUOTE, on one line
      quoted = true;
      p++;
      for (;;) {
        if (p >= end) return null;
        const c = text.charCodeAt(p);
        if (c === 0x22) {
          p++;
          break;
        }
        if (c === 0x0a || c === 0x0d) return null;
        if (c === 0x5c) {
          const n = p + 1 < end ? text.charCodeAt(p + 1) : -1;
          if (n === 0x22 || n === 0x5c) {
            value += text[p + 1];
            p += 2;
          } else {
            // lone: a literal backslash; the character after it is read normally
            value += "\\";
            p++;
          }
          continue;
        }
        value += text[p];
        p++;
      }
    } else {
      const valueStart = p;
      while (p < end && isBareChar(text.charCodeAt(p))) p++;
      if (p === valueStart) return null;
      value = text.slice(valueStart, p);
    }
    attributes.push({ key, value, quoted, start: keyStart, end: p });
    const spaceStart = p;
    while (p < end && text.charCodeAt(p) === SPACE) p++;
    if (p < end && text.charCodeAt(p) === 0x7d) {
      // }
      return { attributes, start: pos, end: p + 1 };
    }
    // Another attribute must follow, separated by at least one space.
    if (p === spaceStart) return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Validation

export const PALETTE = [
  "red",
  "orange",
  "yellow",
  "green",
  "mint",
  "teal",
  "blue",
  "indigo",
  "purple",
  "pink",
  "brown",
  "gray",
  "black",
  "white",
] as const;

export const NAMED_SIZES: Record<string, number> = {
  xs: 0.75,
  small: 0.875,
  normal: 1,
  large: 1.25,
  xl: 1.5,
  xxl: 2,
};

export const GENERIC_FONTS = ["serif", "sans", "mono"] as const;

const STYLE_KEYS = ["color", "bg", "font", "size", "underline"];

/** SPEC 5.3 table: the keys allowed in each place. */
export function allowedKeys(place: AttributePlace): string[] {
  return place === "image" ? ["width"] : STYLE_KEYS;
}

/**
 * Colour value: a palette name (any case, returned in lower case) or #rgb / #rrggbb (hex digits
 * in any case, returned exactly as written: SPEC 5.3 "used exactly as written").
 */
export function validColor(v: string): string | null {
  const lower = v.toLowerCase();
  if ((PALETTE as readonly string[]).includes(lower)) return lower;
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return v;
  return null;
}

export function validBg(v: string): string | null {
  if (v.toLowerCase() === "highlight") return "highlight";
  return validColor(v);
}

/**
 * Font value: a generic name (any case, returned in lower case) or a family name. A family
 * name must hold something other than whitespace; see SPEC-ISSUES.md.
 */
export function validFont(v: string): string | null {
  const lower = v.toLowerCase();
  if ((GENERIC_FONTS as readonly string[]).includes(lower)) return lower;
  if (v.trim() === "") return null;
  return v;
}

/**
 * Size value: a named size (any case, returned in lower case) or a whole number of pixels from
 * 6 to 200 followed by `px` (returned as written).
 */
export function validSize(v: string): string | null {
  const lower = v.toLowerCase();
  if (Object.hasOwn(NAMED_SIZES, lower)) return lower;
  const m = /^([0-9]+)px$/.exec(v);
  if (m) {
    const n = Number(m[1]);
    if (n >= 6 && n <= 200) return v;
  }
  // SPEC 1.2: points, 1 to 400 with at most one decimal, no leading zero.
  const p = /^([1-9][0-9]{0,2})(\.[0-9])?pt$/.exec(v);
  if (p) {
    const n = Number(v.slice(0, -2));
    if (n >= 1 && n <= 400) return v;
  }
  return null;
}

/** A valid size value in points: px count 0.75pt each; a named size gives null (relative). */
export function absoluteSizePt(v: string): number | null {
  if (v.endsWith("pt")) return Number(v.slice(0, -2));
  if (v.endsWith("px")) return Number(v.slice(0, -2)) * 0.75;
  return null;
}

export function validUnderline(v: string): "yes" | "no" | null {
  const lower = v.toLowerCase();
  return lower === "yes" || lower === "no" ? lower : null;
}

/** Image width: 1% to 100%, or 16px to 4000px, whole numbers. Returned as written. */
export function validWidth(v: string): string | null {
  let m = /^([0-9]+)%$/.exec(v);
  if (m) {
    const n = Number(m[1]);
    return n >= 1 && n <= 100 ? v : null;
  }
  m = /^([0-9]+)px$/.exec(v);
  if (m) {
    const n = Number(m[1]);
    return n >= 16 && n <= 4000 ? v : null;
  }
  return null;
}

const VALIDATORS: Record<string, (v: string) => string | null> = {
  color: validColor,
  bg: validBg,
  font: validFont,
  size: validSize,
  underline: validUnderline,
  width: validWidth,
};

/**
 * Applies the validity rules of SPEC 5.3: unknown keys, keys not allowed in this place and
 * invalid values are ignored; for a repeated key only the last occurrence counts, and if that
 * occurrence is invalid the key is ignored.
 */
export function resolveAttributes(
  attributes: readonly { key: string; value: string }[],
  place: AttributePlace,
): ResolvedStyle {
  const allowed = allowedKeys(place);
  const last = new Map<string, string>();
  for (const a of attributes) {
    if (allowed.includes(a.key)) last.set(a.key, a.value);
  }
  const out: ResolvedStyle = {};
  for (const [key, value] of last) {
    const valid = VALIDATORS[key](value);
    if (valid !== null) (out as Record<string, string>)[key] = valid;
  }
  return out;
}

/** SPEC 5.4 condition 4: at least one attribute has a key allowed for the target. */
export function hasAllowedKey(attributes: readonly { key: string }[], place: AttributePlace): boolean {
  const allowed = allowedKeys(place);
  return attributes.some((a) => allowed.includes(a.key));
}
