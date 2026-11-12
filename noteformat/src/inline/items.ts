// The working representation shared by the four inline passes (SPEC 5, step 4).
//
// All positions are indexes into the block's inline text (`InlineInput.text`). An inline scope
// (SPEC 5) is a list of items: runs of literal text and the constructs earlier passes found.
// Constructs that open a new scope (styled span, link text, image description, mark content)
// hold a Scope of their own.

import type { RawAttributeList } from "../attributes.ts";
import type { Range } from "../types.ts";

export interface InlineInput {
  /** The block's inline text: lines joined by "\n", without container markers. */
  text: string;
  /** offsets[i] is the source offset of text[i]; offsets[text.length] is the end. */
  offsets: number[];
  /** The original source, to compute the end of a character (CRLF counts as one). */
  source: string;
}

export interface Definition {
  destination: string;
  title: string | null;
  /** The normalised label. */
  label: string;
  /** Source range of the destination as written. */
  destinationRange: Range;
}

/**
 * Inline constructs nest at most this deep, so that no input can exhaust the stack. The scan pass
 * does not recognise a styled span, link or image whose content already holds this many levels of
 * them, and the emphasis pass does not form emphasis or strikethrough whose content already holds
 * this many levels of them; such brackets and delimiters stay literal text. (Marks cannot nest
 * more than two deep: by the pairing rule of SPEC 5.2 a mark never holds a mark of its own kind.)
 */
export const MAX_NESTING = 32;

/** Below this depth, the tree builder keeps an inline node as its literal source text. */
export const MAX_TREE_DEPTH = 128;

export interface Scope {
  items: Item[];
  /** Position where the scope's text starts and ends. */
  start: number;
  end: number;
}

export interface TextItem {
  k: "text";
  s: number;
  e: number;
}

export interface CodeItem {
  k: "code";
  s: number;
  e: number;
  value: string;
}

export interface AutolinkItem {
  k: "autolink";
  s: number;
  e: number;
  /** The text between `<` and `>`. */
  url: string;
  email: boolean;
}

export interface SpanItem {
  k: "span";
  s: number;
  e: number;
  scope: Scope;
  attrs: RawAttributeList;
  /** Levels of spans, links and images, this one included. */
  depth: number;
}

export interface LinkItem {
  k: "link" | "image";
  s: number;
  e: number;
  scope: Scope;
  destination: string;
  title: string | null;
  kind: "inline" | "reference";
  /** Inline: the destination as written, [destStart, destEnd) in inline text positions. */
  destStart?: number;
  destEnd?: number;
  /** Reference: the definition used. */
  definition?: Definition;
  /** Levels of spans, links and images, this one included. */
  depth: number;
}

export interface MarkItem {
  k: "mark";
  ch: "+" | "=";
  s: number;
  e: number;
  scope: Scope;
}

export interface BareUrlItem {
  k: "bare";
  s: number;
  e: number;
  href: string;
  /** The link text, as written (entity references are not decoded). */
  text: string;
}

export interface EmphasisItem {
  k: "emph" | "strong" | "del";
  s: number;
  e: number;
  items: Item[];
  /** Levels of emphasis and strikethrough, this one included. */
  depth: number;
}

export type Item =
  | TextItem
  | CodeItem
  | AutolinkItem
  | SpanItem
  | LinkItem
  | MarkItem
  | BareUrlItem
  | EmphasisItem;

/** Items that hold an inline scope of their own. */
export function scopeOf(it: Item): Scope | null {
  return it.k === "span" || it.k === "link" || it.k === "image" || it.k === "mark" ? it.scope : null;
}

/** Merges text items that touch, so that a run of literal text is one item. */
export function mergeText(items: Item[]): Item[] {
  const out: Item[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (it.k === "text" && last && last.k === "text" && last.e === it.s) {
      out[out.length - 1] = { k: "text", s: last.s, e: it.e };
    } else if (it.k !== "text" || it.e > it.s) {
      out.push(it);
    }
  }
  return out;
}

/**
 * The items of a scope that fall inside [a, b). Text items are cut at the edges; other items
 * are never cut, because the passes only cut inside literal text.
 */
export function sliceItems(items: readonly Item[], a: number, b: number): Item[] {
  const out: Item[] = [];
  for (const it of items) {
    if (it.e <= a || it.s >= b) continue;
    if (it.k === "text") out.push({ k: "text", s: Math.max(it.s, a), e: Math.min(it.e, b) });
    else out.push(it);
  }
  return out;
}

/** The deepest nesting of spans, links and images among these items (scan pass). */
export function bracketDepth(items: readonly Item[]): number {
  let d = 0;
  for (const it of items) if ((it.k === "span" || it.k === "link" || it.k === "image") && it.depth > d) d = it.depth;
  return d;
}
