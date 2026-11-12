// The wrapper's own rule (SPEC2 7.4.2): an intent's edit stays in its region.
//
// A block's extent is version 1's `region()` of typing.ts: from the start of its first line to
// the end of its attribute line if it has one, with the blank lines after it. A table is one
// block. The ends are inclusive.

import type { Model, BlockModel } from "./style/model.ts";
import type { Intent, Sel, TextEdit } from "./types.ts";

export interface Extent {
  /** Start of the block's first line. */
  start: number;
  /** End of its content (attribute line included). */
  end: number;
  /** End with the blank lines after it: the start of the next non-blank line, or the text's end. */
  outer: number;
}

function lineStartOf(text: string, pos: number): number {
  let s = pos;
  while (s > 0 && text[s - 1] !== "\n") s--;
  return s;
}

function attrEnd(b: BlockModel): number {
  const pb = b.block as { attributes?: { range: { end: number } } } | null;
  return pb && "attributes" in pb && pb.attributes ? Math.max(pb.attributes.range.end, b.info.range.end) : b.info.range.end;
}

/** The end of the blank lines after `end`. */
function afterBlank(text: string, end: number): number {
  let k = end;
  for (;;) {
    if (k >= text.length) return text.length;
    if (text[k] !== "\n") return k;
    let j = k + 1;
    while (j < text.length && (text[j] === " " || text[j] === "\t")) j++;
    if (j >= text.length) return text.length;
    if (text[j] === "\n") {
      k = j;
      continue;
    }
    return k + 1;
  }
}

type TNode = { type: string; range: { start: number; end: number }; children?: TNode[] };

/** The tables of a note, by source range (inside lists and quotes too). */
export function tablesOf(m: Model): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const walk = (bs: TNode[]) => {
    for (const b of bs) {
      if (b.type === "table") out.push({ start: b.range.start, end: b.range.end });
      else if (b.children && (b.type === "list" || b.type === "listItem" || b.type === "blockQuote")) walk(b.children);
    }
  };
  walk(m.note.children as unknown as TNode[]);
  return out;
}

/** Every block's extent, in order. Table cells are replaced by their table. */
export function extents(m: Model): Extent[] {
  const text = m.text;
  const raw: { start: number; end: number }[] = [];
  for (const b of m.blocks) {
    if (b.info.kind === "cell") continue;
    raw.push({ start: lineStartOf(text, b.info.range.start), end: attrEnd(b) });
  }
  for (const t of tablesOf(m)) raw.push({ start: lineStartOf(text, t.start), end: t.end });
  raw.sort((a, b) => a.start - b.start || a.end - b.end);
  return raw.map((r) => ({ ...r, outer: afterBlank(text, r.end) }));
}

/** Where the body starts in a note with front matter: after it and the one blank line that
 *  usually follows it. Further blank lines are the note's own (Enter pressed on an empty note):
 *  Rich mode shows them (change 13) and they can be deleted. 0 without front matter. */
export function bodyStart(m: Model): number {
  const fm = m.note.frontMatter;
  if (!fm) return 0;
  const e = fm.range.end;
  return m.text[e] === "\n" ? e + 1 : e;
}

/** The last table of a note when nothing but blank lines follows it (only a top-level one): its
 *  lines' range and where its last line ends. */
export function finalTable(m: Model): { start: number; end: number } | null {
  const top = (m.note.children as unknown as TNode[]).filter((b) => b.type !== "frontMatter");
  const last = top[top.length - 1];
  if (!last || last.type !== "table") return null;
  let end = last.range.end;
  while (end > last.range.start && (m.text[end - 1] === "\n" || m.text[end - 1] === "\r")) end--;
  const rest = m.text.slice(end);
  if (!/^[ \t\r\n]*$/.test(rest)) return null;
  return { start: lineStartOf(m.text, last.range.start), end };
}

/** The front matter block (an empty one too), or position 0 when there is none. */
export function frontMatterRegion(text: string): [number, number] {
  const m = /^---[ \t]*\n(?:[^\n]*\n)*?---[ \t]*(?:\n|$)/.exec(text);
  if (!m) return [0, 0];
  return [0, m[0].length];
}

/** The region of an intent that is not a setting, table or widget: the blocks the selection
 *  touches and one block on either side; with the caret between blocks, the blocks on either side. */
export function selectionRegion(m: Model, from: number, to: number): [number, number] {
  const ex = extents(m);
  if (ex.length === 0) return [0, m.text.length];
  const touched: number[] = [];
  ex.forEach((e, i) => {
    if (e.start <= to && e.end >= from) touched.push(i);
  });
  let lo: number;
  let hi: number;
  if (touched.length === 0) {
    // Between blocks: the last block before the selection and the first after it.
    let before = -1;
    ex.forEach((e, i) => {
      if (e.end < from) before = i;
    });
    const after = ex.findIndex((e) => e.start > to);
    lo = before >= 0 ? before : -1;
    hi = after >= 0 ? after : ex.length;
    return [lo >= 0 ? ex[lo].start : 0, hi < ex.length ? ex[hi].outer : m.text.length];
  }
  lo = touched[0] - 1;
  hi = touched[touched.length - 1] + 1;
  return [lo >= 0 ? ex[lo].start : 0, hi < ex.length ? ex[hi].outer : m.text.length];
}

/** The extent of the block holding a source position (for widgets). */
export function blockRegionAt(m: Model, pos: number): [number, number] {
  const ex = extents(m);
  const e = ex.find((x) => x.start <= pos && pos <= x.end);
  if (!e) return selectionRegion(m, pos, pos);
  return [e.start, e.outer];
}

/** The region of an intent applied to a document (7.4.2). */
export function regionOf(m: Model, intent: Intent, sel: Sel): [number, number] {
  const from = Math.min(sel.anchor, sel.head);
  const to = Math.max(sel.anchor, sel.head);
  switch (intent.type) {
    case "setMeta":
      return frontMatterRegion(m.text);
    case "tableEdit": {
      const t = tablesOf(m).find((x) => lineStartOf(m.text, x.start) <= intent.at && intent.at <= x.end);
      if (!t) return [intent.at, intent.at];
      return [lineStartOf(m.text, t.start), afterBlank(m.text, t.end)];
    }
    case "setImageWidth": {
      const c = m.chars[intent.at];
      return c ? blockRegionAt(m, c.start) : [0, 0];
    }
    case "toggleTask":
      return blockRegionAt(m, intent.at);
    case "lineAfterTable": {
      const t = finalTable(m);
      return t ? [t.start, m.text.length] : [m.text.length, m.text.length];
    }
    default:
      return selectionRegion(m, from, to);
  }
}

/** The one range that differs between two texts, by their common prefix and suffix. */
export function diff(a: string, b: string): TextEdit | null {
  if (a === b) return null;
  let p = 0;
  const n = Math.min(a.length, b.length);
  while (p < n && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  let s = 0;
  while (s < n - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  return { from: p, to: a.length - s, insert: b.slice(p, b.length - s) };
}

/**
 * The edit from `a` to `b` inside a region, or null when bytes outside the region differ. The
 * shortest prefix-and-suffix range can slide past a region's end when the inserted text begins
 * like the text after it (`---` put before `- item`); this finds the range inside the region.
 */
export function editWithin(a: string, b: string, lo: number, hi: number): TextEdit | null {
  const tail = a.length - hi;
  if (b.length < lo + tail || a.slice(0, lo) !== b.slice(0, lo) || a.slice(hi) !== b.slice(b.length - tail)) return null;
  const d = diff(a, b);
  if (d && d.from >= lo && d.to <= hi) return d;
  let from = lo;
  let to = hi;
  let ins = b.slice(lo, b.length - tail);
  while (from < to && ins.length && a.charCodeAt(from) === ins.charCodeAt(0)) {
    from++;
    ins = ins.slice(1);
  }
  while (to > from && ins.length && a.charCodeAt(to - 1) === ins.charCodeAt(ins.length - 1)) {
    to--;
    ins = ins.slice(0, -1);
  }
  return { from, to, insert: ins };
}

export function inside(edit: TextEdit, region: [number, number]): boolean {
  return edit.from >= region[0] && edit.to <= region[1];
}
