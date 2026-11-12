// A saved style as one line of text, and back (version 1's styles page).

import type { Style } from "../../../contract/src/index.ts";
import { noteColour, ON_HIGHLIGHT } from "../palette.ts";

const FLAGS = ["bold", "italic", "underline", "strike"] as const;

/** `font="Open Sans" size=14 color=red bg=#fff176 bold italic`. */
export function styleText(s: Style): string {
  const out: string[] = [];
  if (s.font) out.push(`font=${/\s/.test(s.font) ? `"${s.font}"` : s.font}`);
  if (s.size !== null) out.push(`size=${s.size}`);
  if (s.color) out.push(`color=${s.color}`);
  if (s.bg) out.push(`bg=${s.bg}`);
  for (const f of FLAGS) if (s[f]) out.push(f);
  return out.join(" ");
}

/** Reads the line back; a word it does not know is an error with the reason. */
export function parseStyleText(name: string, text: string): Style | { error: string } {
  const s: Style = { name, bold: false, italic: false, underline: false, strike: false, size: null, font: null, color: null, bg: null };
  const re = /([A-Za-z]+)(?:=("[^"]*"|\S+))?/g;
  const left = text.replace(re, "").trim();
  if (left !== "") return { error: `"${left}" is not understood` };
  for (const m of text.matchAll(re)) {
    const key = m[1].toLowerCase();
    const value = m[2] === undefined ? undefined : m[2].replace(/^"|"$/g, "");
    if ((FLAGS as readonly string[]).includes(key) && value === undefined) s[key as (typeof FLAGS)[number]] = true;
    else if (key === "strikethrough" && value === undefined) s.strike = true;
    else if (key === "font" && value) s.font = value;
    else if (key === "size" && value && /^\d{1,3}(\.\d)?(pt)?$/.test(value) && parseFloat(value) >= 1 && parseFloat(value) <= 400) s.size = parseFloat(value);
    else if ((key === "color" || key === "colour") && value) s.color = value.toLowerCase();
    else if ((key === "bg" || key === "highlight") && value) s.bg = value.toLowerCase();
    else return { error: `"${m[0]}" is not understood` };
  }
  return s;
}

/** The inline CSS of a style's preview (the note's own colours and fonts, exempt from tokens). */
export function previewCss(s: Style, maxPt = 28): string {
  const out: string[] = [`font-weight: ${s.bold ? 700 : 400}`, `font-style: ${s.italic ? "italic" : "normal"}`];
  const deco = [s.underline ? "underline" : "", s.strike ? "line-through" : ""].filter(Boolean).join(" ");
  out.push(`text-decoration: ${deco || "none"}`);
  if (s.font) out.push(`font-family: ${["serif", "sans", "mono"].includes(s.font) ? `var(--note-font-${s.font})` : `"${s.font.replace(/["\\]/g, "")}"`}`);
  if (s.size) out.push(`font-size: ${Math.min(s.size, maxPt)}pt`);
  if (s.color) out.push(`color: ${noteColour(s.color)}`);
  else if (s.bg) out.push(`color: ${ON_HIGHLIGHT}`);
  if (s.bg) out.push(`background-color: ${noteColour(s.bg)}`);
  return out.join("; ");
}
