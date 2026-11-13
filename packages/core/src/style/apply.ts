// EDITOR-PLAN 5: applyStyle(text, from, to, change). Every command proposes candidate edits and
// keeps the first that passes the check of 5.1 (check.ts). Nothing else decides correctness.

import { type Block, type RunStyle } from "../../../../noteformat/src/index.ts";
import { firstLineEnding } from "../text.ts";
import { check, type Expect } from "./check.ts";
import { allNodes, buildModel, spanOf, type BlockModel, type INode, type Model } from "./model.ts";
import { attrValue, editAttrs, endPlaces, escapeLinkText, escapeText, Patch, placePairs, startPlaces, writeBoundary, writeDest } from "./edits.ts";
import { isBlank } from "./blank.ts";

export type AttrKey = "color" | "bg" | "font" | "size" | "underline";

export type Change =
  /** Text colour, highlight or font; `null` is "None" / "Default". */
  | { kind: "color" | "bg" | "font"; value: string | null }
  /** Size N points (EDITOR-PLAN 4). `own` marks a size that is only the block's own (a saved
   *  style that names none): while it waits to be typed, it follows the block (reduce.ts). */
  | { kind: "size"; pt: number; own?: true }
  /** One point up or down from each character's own size (SPEC2 1.3). */
  | { kind: "size-step"; dir: 1 | -1 }
  | { kind: "underline"; on: boolean }
  | { kind: "bold" | "italic" | "strike"; on: boolean }
  | { kind: "code"; on: boolean }
  /** Add or change a link to `url`; `null` removes the links in the selection. */
  | { kind: "link"; url: string | null }
  | { kind: "clear" };

export type Result =
  | {
      ok: true;
      text: string;
      from: number;
      to: number;
      /** Blocks left as they were, and why. */
      skipped: { count: number; reasons: string[] };
      /** The visible characters the change was made to (code spans and refused blocks drop out). */
      applied: number[];
    }
  | { ok: false; reason: string };

/** Sizes are in points, 1 to 400 with one decimal (SPEC2 7.6). */
export const MIN_SIZE = 1;
export const MAX_SIZE = 400;

/** SPEC2 1.3 and 7.6: `−` and `+` move a size by 1 point, kept within 1 to 400. */
export function stepSize(current: number, dir: 1 | -1): number {
  // A size already past the end it moves to (a heading in a large note can be over 400) stays
  // as it is: + never makes text smaller, nor − larger (version 2 code review, 22).
  if ((dir > 0 && current >= MAX_SIZE) || (dir < 0 && current <= MIN_SIZE)) return current;
  const r = Math.round((current + dir) * 10) / 10;
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, r));
}

/** A size in points as an attribute value: `14pt`, `10.5pt`. */
export function ptValue(pt: number): string {
  const r = Math.round(pt * 10) / 10;
  return `${Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)}pt`;
}

/** The visible characters a source selection holds: those wholly inside [from, to). */
export function selectedChars(m: Model, from: number, to: number): number[] {
  const out: number[] = [];
  m.chars.forEach((c, i) => {
    if (c.start >= from && c.end <= to) out.push(i);
  });
  return out;
}

export function applyStyle(text: string, from: number, to: number, change: Change): Result {
  const m = buildModel(text);
  const sel = selectedChars(m, Math.min(from, to), Math.max(from, to));
  if (sel.length === 0) return { ok: false, reason: "nothing is selected" };
  if (change.kind === "clear") return clearFormatting(text, from, to);
  if (change.kind === "link") return linkCommand(m, sel, change.url);
  // By block, last first, so that earlier positions stay where they are.
  const byBlock = new Map<number, number[]>();
  for (const i of sel) {
    const b = m.chars[i].block;
    byBlock.set(b, [...(byBlock.get(b) ?? []), i]);
  }
  let cur = text;
  const reasons: string[] = [];
  let done = 0;
  const applied: number[] = [];
  for (const [bi, idx] of [...byBlock].sort((x, y) => y[0] - x[0])) {
    const r = applyBlock(cur, bi, idx[0], idx[idx.length - 1] + 1, change);
    if (typeof r === "string") cur = r;
    else {
      reasons.push(r.reason);
      continue;
    }
    const [ta, tb] = trimCode(m.blocks[bi], idx[0], idx[idx.length - 1] + 1);
    for (let i = ta; i < tb; i++) applied.push(i);
    if (tb - ta < idx.length) reasons.push("part of a code span");
    done++;
  }
  if (done === 0) return { ok: false, reason: reasons[0] ?? "nothing could be changed" };
  // Every selected character already looked as asked: done, with nothing to change.
  const nm = buildModel(cur);
  return {
    ok: true,
    text: cur,
    from: nm.chars[sel[0]].start,
    to: nm.chars[sel[sel.length - 1]].end,
    skipped: { count: reasons.length, reasons: [...new Set(reasons)] },
    applied: applied.sort((x, y) => x - y),
  };
}

// --------------------------------------------------------------------------------------------
// One block

type Refusal = { reason: string };

/** What a selected character must look like afterwards. */
function wantFor(change: Change, m: Model): (s: RunStyle, i: number) => RunStyle {
  switch (change.kind) {
    case "color":
      return (s) => ({ ...s, color: change.value === null ? null : change.value.toLowerCase() });
    case "bg":
      return (s) => ({ ...s, bg: change.value === null ? null : change.value.toLowerCase() });
    case "font":
      return (s, i) => ({ ...s, font: change.value ?? defaultFont(m, i) });
    case "size":
      return (s) => ({ ...s, size: change.pt });
    case "size-step":
      return (s) => ({ ...s, size: stepSize(s.size, change.dir) });
    case "underline":
      return (s) => ({ ...s, underline: change.on });
    case "bold":
      return (s) => ({ ...s, bold: change.on });
    case "italic":
      return (s) => ({ ...s, italic: change.on });
    case "strike":
      return (s) => ({ ...s, strike: change.on });
    case "code":
      return (s) => ({ ...s, code: change.on });
    default:
      return (s) => s;
  }
}

/** The font a character has without any span or block attribute: the note's font (not for code). */
function defaultFont(m: Model, i: number): string | null {
  return m.chars[i].style.code ? null : (m.note.frontMatter?.fields.font ?? null);
}

/** The block's size without its block attribute line (EDITOR-PLAN 4: "the block already gives"). */
function natural(m: Model, blk: BlockModel): number {
  const info = blk.info;
  if (info.kind !== "heading") return m.runs.noteSize;
  const factors = [2, 1.5, 1.1667, 1, 0.9167, 0.8333];
  return m.runs.noteSize * factors[(info.level ?? 1) - 1];
}

function applyBlock(text: string, bi: number, a: number, b: number, change: Change): string | Refusal {
  const m = buildModel(text);
  const blk = m.blocks[bi];
  if (blk.info.kind === "code") return { reason: "inside a code block" };
  // A code span only partly selected is left out (EDITOR-PLAN 5.2).
  [a, b] = trimCode(blk, a, b);
  if (a >= b) return { reason: "part of a code span" };
  const want = wantFor(change, m);
  const selected = new Set<number>();
  for (let i = a; i < b; i++) selected.add(i);
  const expect: Expect = { selected, style: want, blocks: [bi] };
  // Nothing to do when every selected character already looks as asked.
  if ([...selected].every((i) => sameStyle(m.chars[i].style, want(m.chars[i].style, i)))) return text;
  switch (change.kind) {
    case "color":
    case "bg":
    case "font":
      return attrCommand(text, bi, a, b, change.kind, () => (change.value === null ? [null] : [change.value]), expect);
    case "size":
      return attrCommand(text, bi, a, b, "size", (mm, blk2) => sizeValues(mm, blk2, change.pt), expect);
    case "size-step":
      return sizeStep(text, bi, a, b, change.dir, expect);
    case "underline":
      return attrCommand(text, bi, a, b, "underline", () => (change.on ? ["yes"] : [null, "no"]), expect);
    case "bold":
    case "italic":
    case "strike":
      return toggleCommand(text, bi, a, b, change.kind, change.on, expect);
    case "code":
      return codeCommand(text, bi, a, b, change.on, expect);
    default:
      return { reason: "unknown command" };
  }
}

function sameStyle(x: RunStyle, y: RunStyle): boolean {
  return (
    x.bold === y.bold &&
    x.italic === y.italic &&
    x.strike === y.strike &&
    x.code === y.code &&
    x.underline === y.underline &&
    x.color === y.color &&
    x.bg === y.bg &&
    x.font === y.font &&
    Math.abs(x.size - y.size) < 1e-6 &&
    x.link === y.link
  );
}

/** The values to try for size N: removing the size when the block already gives N, then Npt. */
function sizeValues(m: Model, blk: BlockModel, pt: number): (string | null)[] {
  const out: (string | null)[] = [];
  if (Math.abs(natural(m, blk) - pt) < 1e-6) out.push(null);
  out.push(ptValue(pt));
  return out;
}

function trimCode(blk: BlockModel, a: number, b: number): [number, number] {
  for (const n of allNodes(blk.root)) {
    if (n.kind !== "code") continue;
    if (n.va < a && a < n.vb) a = n.vb;
    if (n.va < b && b < n.vb) b = n.va;
  }
  return [a, b];
}

function tryCandidates(old: Model, candidates: (() => string | null)[], expect: Expect): string | Refusal {
  let reason = "the change could not be made safely";
  for (const make of candidates) {
    const t = make();
    if (t === null) continue;
    const r = check(old, t, expect);
    if (r === null) return t;
    reason = r;
  }
  return { reason };
}

// --------------------------------------------------------------------------------------------
// Colour, highlight, font, size and underline (EDITOR-PLAN 5.3)

type ValuesFor = (m: Model, blk: BlockModel) => (string | null)[];

function attrCommand(text: string, bi: number, a: number, b: number, key: AttrKey, valuesFor: ValuesFor, expect: Expect): string | Refusal {
  const m = buildModel(text);
  const blk = m.blocks[bi];
  const e: Expect = { ...expect, key };
  const values = valuesFor(m, blk);
  const whole = a === blk.va && b === blk.vb;
  const candidates: (() => string | null)[] = [];
  const line = lineAttr(blk, key);
  // Each value in turn (removing a value comes before writing one):
  for (const v of values) {
    // 1. The whole block, where the format allows a block attribute line.
    if (whole && lineAllowed(blk)) candidates.push(() => blockLine(text, bi, key, v));
    // 2. Pieces, with spans.
    candidates.push(() => pieces(text, bi, a, b, key, v, e));
    // 3. A value that comes from the block's line, removed or changed for part of the block.
    //    Not for size, which is always written as an absolute value (EDITOR-PLAN 5.3 step 3).
    if (line !== null && !whole && !(key === "size" && v === null)) candidates.push(() => pushDown(text, bi, a, b, key, line, v, e));
  }
  return tryCandidates(m, candidates, e);
}

/** A block that may carry a block attribute line for colour, size and the like. */
function lineAllowed(blk: BlockModel): boolean {
  const pb = blk.block as (Block & { attributes?: { target: string } }) | null;
  if (!blk.info.topLevel) return false;
  if (blk.info.kind !== "paragraph" && blk.info.kind !== "heading") return false;
  if (pb && "attributes" in pb && pb.attributes && pb.attributes.target === "image") return false;
  return true;
}

/** The value the block's attribute line gives `key`, as written; null when it gives none. */
function lineAttr(blk: BlockModel, key: AttrKey): string | null {
  const v = (blk.info.line as Record<string, string | undefined>)[key];
  return v === undefined ? null : v;
}

type ParaOrHeading = Block & { attributes?: { target: string; range: { start: number; end: number }; list: { range: { start: number; end: number }; attributes: { key: string; value: string; range: { start: number; end: number } }[] } } };

/** Sets (or removes) `key` on the block's attribute line, and removes it from every span. */
function blockLine(text: string, bi: number, key: AttrKey, value: string | null): string | null {
  const m = buildModel(text);
  const blk = m.blocks[bi];
  const pb = blk.block as ParaOrHeading | null;
  if (!pb) return null;
  const p = new Patch();
  const attrs = pb.attributes && pb.attributes.target !== "image" ? pb.attributes : null;
  if (attrs) {
    const list = { start: attrs.list.range.start, end: attrs.list.range.end, list: attrs.list.attributes.map((x) => ({ key: x.key, value: x.value, start: x.range.start, end: x.range.end })) };
    const edited = editAttrs(text, list, key, value);
    if (edited === null) {
      // No attribute left: the line goes, with the line ending before it.
      const lineStart = attrs.range.start;
      const eol = text.slice(lineStart - 2, lineStart) === "\r\n" ? 2 : 1;
      p.replace(lineStart - eol, attrs.range.end, "");
    } else p.replace(list.start, list.end, edited);
  } else if (value !== null) {
    const end = pb.type === "heading" ? pb.range.end : blk.info.range.end;
    const after = text.slice(end);
    const eolMatch = /^(\r\n|\n|\r)/.exec(after);
    const eol = eolMatch ? eolMatch[1] : firstLineEnding(text);
    let insert = `${eol}{${key}=${attrValue(value)}}`;
    // SPEC 5.4: the line after a block attribute line is blank or the end of the file.
    if (eolMatch) {
      const next = after.slice(eolMatch[1].length).split(/\r\n|\n|\r/)[0];
      if (!isBlank(next)) insert += eol;
    }
    p.insert(end, insert);
  } else return null;
  // Nothing in the block overrides the line.
  for (const n of allNodes(blk.root)) if (n.kind === "span") unsetInSpan(p, text, n, key);
  return p.apply(text);
}

function unsetInSpan(p: Patch, text: string, n: INode, key: string): void {
  if (!n.attrs || !n.attrs.list.some((x) => x.key === key)) return;
  const edited = editAttrs(text, n.attrs, key, null);
  if (edited === null) {
    p.replace(n.start, n.contentStart, "");
    p.replace(n.contentEnd, n.end, "");
  } else p.replace(n.attrs.start, n.attrs.end, edited);
}

/**
 * Visible pieces in the block: segments by span, each written with spans (5.3 step 2). First as
 * the text is; then with the `++` and `==` marks the selection touches written as spans, which
 * can be divided where a mark cannot (a mark cannot close after a space).
 */
function pieces(text: string, bi: number, a: number, b: number, key: AttrKey, value: string | null, e: Expect): string | null {
  const base = convertLinks(text, bi, a, b);
  const variants: string[] = [];
  // Underline off and highlight off cannot be done inside a mark: it must become a span.
  const mustConvert = (key === "underline" && value !== "yes") || (key === "bg" && value === null);
  if (!mustConvert) variants.push(base);
  const allMarks = convertMarks(base, bi, a, b, "underline", "highlight");
  if (allMarks !== null) variants.push(allMarks);
  else if (mustConvert) variants.push(base);
  for (const fine of [false, true]) {
    for (const v of variants) {
      const r = piecesOn(v, bi, a, b, key, value, e, fine);
      if (r === null) continue;
      if (r === text ? satisfied(buildModel(text), e) : check(buildModel(text), r, e) === null) return r;
    }
  }
  return null;
}

/** Every selected character already looks as asked. */
function satisfied(m: Model, e: Expect): boolean {
  return [...e.selected].every((i) => sameStyle(m.chars[i].style, e.style(m.chars[i].style, i)));
}

function piecesOn(text: string, bi: number, a: number, b: number, key: AttrKey, value: string | null, e: Expect, fine = false): string | null {
  let cur = text;
  const m = buildModel(cur);
  // By span; or (`fine`) cut at the edge of every inline element (5.3 step 2).
  const segs = fine ? cutAtEdges(m.blocks[bi], a, b) : segments(m.blocks[bi], a, b);
  for (const [sa, sb] of segs.reverse()) {
    const r = segment(cur, bi, sa, sb, key, value, e);
    if (r === null) return null;
    cur = r;
  }
  return cur;
}

/** [a, b) cut at the edge of every inline element inside it, so no piece crosses one. */
function cutAtEdges(blk: BlockModel, a: number, b: number): [number, number][] {
  const cuts = new Set<number>();
  for (const n of allNodes(blk.root)) {
    if (n.children.length === 0 && n.kind !== "link") continue;
    if (n.va > a && n.va < b) cuts.add(n.va);
    if (n.vb > a && n.vb < b) cuts.add(n.vb);
  }
  const points = [a, ...[...cuts].sort((x, y) => x - y), b];
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < points.length; k++) if (points[k] < points[k + 1]) out.push([points[k], points[k + 1]]);
  return out;
}

/** [a, b) cut where the nearest span changes. */
function segments(blk: BlockModel, a: number, b: number): [number, number][] {
  const out: [number, number][] = [];
  let s = a;
  let cur = spanOf(blk.root, a);
  for (let i = a + 1; i < b; i++) {
    const sp = spanOf(blk.root, i);
    if (sp !== cur) {
      out.push([s, i]);
      s = i;
      cur = sp;
    }
  }
  out.push([s, b]);
  return out;
}

/** One segment: inside one span, or outside every span. */
function segment(text: string, bi: number, a: number, b: number, key: AttrKey, value: string | null, e: Expect): string | null {
  const m = buildModel(text);
  const blk = m.blocks[bi];
  const span = spanOf(blk.root, a);
  const sel = new Set<number>();
  for (let i = a; i < b; i++) sel.add(i);
  const local: Expect = { ...e, selected: sel };
  const results: string[] = [];
  if (span && span.attrs) {
    const orig = text.slice(span.attrs.start, span.attrs.end);
    const has = span.attrs.list.some((x) => x.key === key);
    if (value === null && !has) return text; // nothing here sets it
    const newAttrs = editAttrs(text, span.attrs, key, value);
    if (a === span.va && b === span.vb) {
      const p = new Patch();
      if (newAttrs === null) {
        p.replace(span.start, span.contentStart, "");
        p.replace(span.contentEnd, span.end, "");
      } else p.replace(span.attrs.start, span.attrs.end, newAttrs);
      results.push(p.apply(text)!);
    } else {
      const starts = a > span.va ? startPlaces(m, span.children, a) : [{ pos: span.contentStart, crossed: [] }];
      const ends = b < span.vb ? endPlaces(m, span.children, b) : [{ pos: span.contentEnd, crossed: [] }];
      for (const s of starts) {
        for (const en of ends) {
          const p = new Patch();
          if (a > span.va) writeBoundary(p, text, s.pos, s.crossed, "]" + orig + (newAttrs ? "[" : ""));
          else if (!newAttrs) p.replace(span.start, span.contentStart, "");
          if (b < span.vb) writeBoundary(p, text, en.pos, en.crossed, (newAttrs ? "]" + newAttrs : "") + "[");
          else if (newAttrs) p.replace(span.attrs.start, span.attrs.end, newAttrs);
          else p.replace(span.contentEnd, span.end, "");
          const t = p.apply(text);
          if (t !== null) results.push(t);
        }
      }
    }
  } else {
    if (value === null) return text; // nothing to remove outside spans
    const attrs = `{${key}=${attrValue(value)}}`;
    for (const pair of placePairs(startPlaces(m, blk.root, a), endPlaces(m, blk.root, b))) {
      for (const escape of [false, true]) {
        const p = new Patch();
        writeBoundary(p, text, pair.s.pos, pair.s.crossed.slice(pair.common), "[");
        writeBoundary(p, text, pair.e.pos, pair.e.crossed.slice(pair.common), "]" + attrs);
        if (escape) escapeBrackets(p, m, text, a, b, pair.s.pos);
        const t = p.apply(text);
        if (t !== null) results.push(t);
      }
    }
  }
  for (const t of results) {
    if (t === text) {
      // Nothing to write: fine if every selected character already looks as asked.
      if ([...sel].every((i) => sameStyle(m.chars[i].style, local.style(m.chars[i].style, i)))) return text;
      continue;
    }
    if (check(m, t, local) === null) return t;
  }
  return null;
}

/** Escapes `[ ] { }` in the selected text, and a `!` right before the new `[`. */
function escapeBrackets(p: Patch, m: Model, text: string, a: number, b: number, open: number): void {
  for (let i = a; i < b; i++) {
    const c = m.chars[i];
    if (c.kind === "text" && !c.style.code && "[]{}".includes(c.ch) && c.end - c.start === 1) p.insert(c.start, "\\");
  }
  if (text[open - 1] === "!" && text[open - 2] !== "\\") p.insert(open - 1, "\\");
}

/** A bare web address or `<address>` crossed by the selection becomes `[address](address)`. */
function convertLinks(text: string, bi: number, a: number, b: number): string {
  const m = buildModel(text);
  const p = new Patch();
  for (const n of allNodes(m.blocks[bi].root)) {
    if (n.kind !== "link" || (n.linkKind !== "bare" && n.linkKind !== "autolink")) continue;
    const crossed = (n.va < a && a < n.vb) || (n.va < b && b < n.vb);
    if (!crossed) continue;
    const shown = m.chars.slice(n.va, n.vb).map((c) => c.ch).join("");
    p.replace(n.start, n.end, `[${escapeLinkText(shown)}](${writeDest(n.destination!)})`);
  }
  if (p.empty) return text;
  const t = p.apply(text);
  return t ?? text;
}

/** A `++` (or `==`) mark the selection is in becomes a span, so that part of it can change. */
function convertMarks(text: string, bi: number, a: number, b: number, ...kinds: ("underline" | "highlight")[]): string | null {
  const m = buildModel(text);
  const p = new Patch();
  for (const n of allNodes(m.blocks[bi].root)) {
    if (!kinds.includes(n.kind as "underline") || n.vb <= a || n.va >= b) continue;
    // Inside a span, or holding one, a mark cannot become a span.
    let up = n.parent;
    let inSpan = false;
    while (up) {
      if (up.kind === "span") inSpan = true;
      up = up.parent;
    }
    if (inSpan || [...allNodes(n.children)].some((x) => x.kind === "span")) continue;
    p.replace(n.start, n.contentStart, "[");
    p.replace(n.contentEnd, n.end, n.kind === "underline" ? "]{underline=yes}" : "]{bg=highlight}");
  }
  if (p.empty) return null;
  return p.apply(text);
}

/**
 * 5.3 step 3: a value that comes from the block's attribute line, changed for part of the
 * block. The key comes off the line and goes on spans around the parts that keep it.
 */
function pushDown(text: string, bi: number, a: number, b: number, key: AttrKey, lineValue: string, value: string | null, e: Expect): string | null {
  const m0 = buildModel(text);
  const off = blockLine(text, bi, key, null);
  if (off === null) return null;
  // The parts of the block whose look changed when the line lost the key get it back.
  let cur = off;
  const m1 = buildModel(off);
  const blk = m0.blocks[bi];
  const runs: [number, number][] = [];
  let s = -1;
  for (let i = blk.va; i <= blk.vb; i++) {
    const outside = i < blk.vb && (i < a || i >= b) && !sameStyle(m0.chars[i].style, m1.chars[i].style);
    if (outside && s < 0) s = i;
    if (!outside && s >= 0) {
      runs.push([s, i]);
      s = -1;
    }
  }
  const keep: Expect = { selected: new Set(), style: (st) => st, blocks: [bi], key };
  for (const [ra, rb] of runs.reverse()) {
    const sel = new Set<number>();
    for (let i = ra; i < rb; i++) sel.add(i);
    const back: Expect = { ...keep, selected: sel, style: (_st, i) => m0.chars[i].style };
    const r = pieces(cur, bi, ra, rb, key, lineValue, back);
    if (r === null) return null;
    cur = r;
  }
  // The selected part.
  const r = pieces(cur, bi, a, b, key, value, e);
  return r;
}

function sizeStep(text: string, bi: number, a: number, b: number, dir: 1 | -1, expect: Expect): string | Refusal {
  const m = buildModel(text);
  // Pieces of equal target size, each moved to it, last first.
  const groups: [number, number, number][] = [];
  for (let i = a; i < b; i++) {
    const t = stepSize(m.chars[i].style.size, dir);
    const g = groups[groups.length - 1];
    if (g && g[2] === t && g[1] === i) g[1] = i + 1;
    else groups.push([i, i + 1, t]);
  }
  let cur = text;
  for (const [ga, gb, pt] of groups.reverse()) {
    const sel = new Set<number>();
    for (let i = ga; i < gb; i++) sel.add(i);
    const r = attrCommand(cur, bi, ga, gb, "size", (mm, blk) => sizeValues(mm, blk, pt), { ...expect, selected: sel, style: (s) => ({ ...s, size: pt }) });
    if (typeof r !== "string") return r;
    cur = r;
  }
  const r = check(m, cur, { ...expect, key: "size" });
  return r === null ? cur : { reason: r };
}

// --------------------------------------------------------------------------------------------
// Bold, italic, strikethrough (EDITOR-PLAN 5.4)

const DELIMS: Record<"bold" | "italic" | "strike", string[]> = { bold: ["**", "__"], italic: ["*", "_"], strike: ["~~", "~"] };
const NODE: Record<"bold" | "italic" | "strike", string> = { bold: "strong", italic: "emphasis", strike: "strike" };
const PROP: Record<"bold" | "italic" | "strike", "bold" | "italic" | "strike"> = { bold: "bold", italic: "italic", strike: "strike" };

function toggleCommand(text: string, bi: number, a: number, b: number, what: "bold" | "italic" | "strike", on: boolean, expect: Expect): string | Refusal {
  const m = buildModel(text);
  const candidates: (() => string | null)[] = [];
  if (on) {
    for (const d of DELIMS[what]) {
      candidates.push(() => wrapOn(text, bi, a, b, what, d, true));
      // Spans cut by the selection's edges are divided there, so the delimiters can go
      // outside them, across the whole selection.
      candidates.push(() => {
        const split = splitSpansAt(text, bi, a, b);
        return split === null ? null : wrapPart(split, bi, a, b, what, d);
      });
      candidates.push(() => wrapOn(text, bi, a, b, what, d, false));
      // A mark the selection cuts into cannot close after a space: it becomes a span first.
      candidates.push(() => {
        const c = convertMarks(text, bi, a, b, "underline", "highlight");
        if (c === null) return null;
        const split = splitSpansAt(c, bi, a, b);
        return split === null ? null : wrapPart(split, bi, a, b, what, d);
      });
      candidates.push(() => {
        const c = convertMarks(text, bi, a, b, "underline", "highlight");
        return c === null ? null : wrapOn(c, bi, a, b, what, d, false);
      });
      // Cut at the edge of every inline element; each piece is wrapped in its own scope.
      candidates.push(() => wrapFine(text, bi, a, b, what, d));
    }
  } else {
    for (const d of DELIMS[what]) candidates.push(() => toggleOff(text, bi, a, b, what, d));
  }
  return tryCandidates(m, candidates, expect);
}

/** Turns the style on: with `merge`, over the whole selection at once; else piece by piece. */
function wrapOn(text: string, bi: number, a: number, b: number, what: "bold" | "italic" | "strike", d: string, merge: boolean): string | null {
  let cur = convertLinks(text, bi, a, b);
  const m = buildModel(cur);
  const blk = m.blocks[bi];
  const prop = PROP[what];
  // The parts to wrap, by span segment.
  const parts: [number, number][] = [];
  for (const [sa, sb] of segments(blk, a, b)) {
    if (merge) parts.push([sa, sb]);
    else {
      let s = -1;
      for (let i = sa; i <= sb; i++) {
        const need = i < sb && !m.chars[i].style[prop];
        if (need && s < 0) s = i;
        if (!need && s >= 0) {
          parts.push([s, i]);
          s = -1;
        }
      }
    }
  }
  for (const [pa, pb] of parts.reverse()) {
    const r = wrapPart(cur, bi, pa, pb, what, d);
    if (r === null) return null;
    cur = r;
  }
  return cur;
}

/** Wraps each piece of [a, b) cut at element edges that lacks the style. */
function wrapFine(text: string, bi: number, a: number, b: number, what: "bold" | "italic" | "strike", d: string): string | null {
  let cur = convertLinks(text, bi, a, b);
  const m = buildModel(cur);
  const prop = PROP[what];
  const pieces = cutAtEdges(m.blocks[bi], a, b).filter(([pa, pb]) => m.chars.slice(pa, pb).some((c) => !c.style[prop]));
  for (const [pa, pb] of pieces.reverse()) {
    const r = wrapPart(cur, bi, pa, pb, what, d);
    if (r === null) return null;
    cur = r;
  }
  return cur;
}

/** Wraps [a, b) with the delimiter, removing the same style inside it first. */
function wrapPart(text: string, bi: number, a: number, b: number, what: "bold" | "italic" | "strike", d: string): string | null {
  const m = buildModel(text);
  // Spaces at the edges stay outside the delimiters.
  while (a < b && /\s/.test(m.chars[a].ch)) a++;
  while (b > a && /\s/.test(m.chars[b - 1].ch)) b--;
  if (a >= b) return text;
  const blk = m.blocks[bi];
  const inSpan = spanOf(blk.root, a);
  const scope = inSpan && inSpan === spanOf(blk.root, b - 1) ? inSpan.children : blk.root;
  // Grow over elements of the same style that the part cuts into; their delimiters go.
  const kind = NODE[what];
  for (const n of allNodes(scope)) {
    if (n.kind === kind && n.vb > a && n.va < b) {
      a = Math.min(a, n.va);
      b = Math.max(b, n.vb);
    }
  }
  const pairs = placePairs(startPlaces(m, scope, a), endPlaces(m, scope, b));
  for (const pair of pairs) {
    const q = new Patch();
    // The same removals, then the wrap.
    for (const n of allNodes(scope)) {
      if (n.kind === kind && n.va >= a && n.vb <= b) {
        q.replace(n.start, n.contentStart, "");
        q.replace(n.contentEnd, n.end, "");
      }
    }
    const sCross = pair.s.crossed.slice(pair.common).filter((x) => x.kind !== kind);
    const eCross = pair.e.crossed.slice(pair.common).filter((x) => x.kind !== kind);
    if (pair.s.crossed.slice(0, pair.common).some((x) => x.kind === kind)) continue;
    writeBoundary(q, text, pair.s.pos, sCross, d);
    writeBoundary(q, text, pair.e.pos, eCross, d);
    const t = q.apply(text);
    if (t !== null) {
      const want: Expect = {
        selected: new Set(range(a, b)),
        style: (s) => ({ ...s, [PROP[what]]: true }),
        blocks: [bi],
      };
      if (check(m, t, want) === null) return t;
    }
  }
  return null;
}

/** Divides each span the edges of [a, b) cut through into two spans with the same attributes. */
function splitSpansAt(text: string, bi: number, a: number, b: number): string | null {
  const m = buildModel(text);
  const blk = m.blocks[bi];
  const p = new Patch();
  for (const k of [a, b]) {
    const sp = spanOf(blk.root, k);
    if (!sp || !sp.attrs || k <= sp.va || k >= sp.vb) continue;
    const places = startPlaces(m, sp.children, k);
    if (places.length === 0) return null;
    const pl = places[places.length - 1];
    writeBoundary(p, text, pl.pos, pl.crossed, "]" + text.slice(sp.attrs.start, sp.attrs.end) + "[");
  }
  if (p.empty) return text;
  return p.apply(text);
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i < b; i++) out.push(i);
  return out;
}

/** Turns the style off for [a, b): every such element in it loses its delimiters, and the parts
 *  of them outside the selection are wrapped again. */
function toggleOff(text: string, bi: number, a: number, b: number, what: "bold" | "italic" | "strike", d: string): string | null {
  const m = buildModel(text);
  const blk = m.blocks[bi];
  const kind = NODE[what];
  const p = new Patch();
  const rewrap: [number, number][] = [];
  for (const n of allNodes(blk.root)) {
    if (n.kind !== kind || n.vb <= a || n.va >= b) continue;
    p.replace(n.start, n.contentStart, "");
    p.replace(n.contentEnd, n.end, "");
    if (n.va < a) rewrap.push([n.va, a]);
    if (n.vb > b) rewrap.push([b, n.vb]);
  }
  let cur = p.apply(text);
  if (cur === null) return null;
  for (const [ra, rb] of rewrap.sort((x, y) => y[0] - x[0])) {
    const r = wrapPart(cur, bi, ra, rb, what, d);
    if (r === null) return null;
    cur = r;
  }
  return cur;
}

// --------------------------------------------------------------------------------------------
// Inline code

function codeCommand(text: string, bi: number, a: number, b: number, on: boolean, expect: Expect): string | Refusal {
  const m = buildModel(text);
  const blk = m.blocks[bi];
  if (on) {
    // Only plain text inside one piece of text becomes code.
    const node = [...allNodes(blk.root)].find((n) => n.kind === "text" && n.va <= a && b <= n.vb);
    if (!node) return { reason: "the selection crosses other formatting" };
    if (m.chars.slice(a, b).some((c) => c.kind !== "text")) return { reason: "the selection holds a line break" };
    const shown = m.chars.slice(a, b).map((c) => c.ch).join("");
    const longest = Math.max(0, ...(shown.match(/`+/g) ?? []).map((x) => x.length));
    const fence = "`".repeat(longest + 1);
    const pad = shown.startsWith("`") || shown.endsWith("`") || (shown.startsWith(" ") && shown.endsWith(" ") && shown.trim() !== "") ? " " : "";
    const t = new Patch().replace(m.chars[a].start, m.chars[b - 1].end, fence + pad + shown + pad + fence).apply(text);
    return tryCandidates(m, [() => t], expect);
  }
  const p = new Patch();
  for (const n of allNodes(blk.root)) {
    if (n.kind !== "code" || n.vb <= a || n.va >= b) continue;
    const shown = m.chars.slice(n.va, n.vb).map((c) => c.ch).join("");
    p.replace(n.start, n.end, escapeText(shown));
  }
  return tryCandidates(m, [() => p.apply(text)], expect);
}

// --------------------------------------------------------------------------------------------
// Links

function linkCommand(m: Model, sel: number[], url: string | null): Result {
  const text = m.text;
  const a = sel[0];
  const b = sel[sel.length - 1] + 1;
  const bi = m.chars[a].block;
  if (m.chars[b - 1].block !== bi) return { ok: false, reason: "a link cannot cross blocks" };
  const blk = m.blocks[bi];
  if (blk.info.kind === "code") return { ok: false, reason: "inside a code block" };
  const links = [...allNodes(blk.root)].filter((n) => n.kind === "link" && n.vb > a && n.va < b);
  const candidates: string[] = [];
  let selected = new Set(sel);
  if (url === null) {
    if (links.length === 0) return { ok: false, reason: "there is no link here" };
    const p = new Patch();
    selected = new Set();
    for (const n of links) {
      for (let i = n.va; i < n.vb; i++) selected.add(i);
      if (n.linkKind === "inline" || n.linkKind === "reference") {
        p.replace(n.start, n.contentStart, "");
        p.replace(n.contentEnd, n.end, "");
      } else {
        const shown = m.chars.slice(n.va, n.vb).map((c) => c.ch).join("");
        p.replace(n.start, n.end, escapeText(shown));
      }
    }
    const t = p.apply(text);
    if (t) candidates.push(t);
  } else if (links.length === 1 && links[0].va <= a && b <= links[0].vb) {
    // Change the address of the link the selection is in.
    const n = links[0];
    selected = new Set(range(n.va, n.vb));
    const p = new Patch();
    if (n.linkKind === "inline" || n.linkKind === "reference") p.replace(n.contentEnd, n.end, `](${writeDest(url)})`);
    else {
      const shown = m.chars.slice(n.va, n.vb).map((c) => c.ch).join("");
      p.replace(n.start, n.end, `[${escapeLinkText(shown)}](${writeDest(url)})`);
    }
    const t = p.apply(text);
    if (t) candidates.push(t);
  } else {
    if (links.length) return { ok: false, reason: "the selection already holds a link" };
    const scope = spanOf(blk.root, a)?.children ?? blk.root;
    if (spanOf(blk.root, a) !== spanOf(blk.root, b - 1)) return { ok: false, reason: "the selection crosses styled text" };
    for (const pair of placePairs(startPlaces(m, scope, a), endPlaces(m, scope, b))) {
      for (const escape of [false, true]) {
        const p = new Patch();
        writeBoundary(p, text, pair.s.pos, pair.s.crossed.slice(pair.common), "[");
        writeBoundary(p, text, pair.e.pos, pair.e.crossed.slice(pair.common), `](${writeDest(url)})`);
        if (escape) escapeBrackets(p, m, text, a, b, pair.s.pos);
        const t = p.apply(text);
        if (t) candidates.push(t);
      }
    }
  }
  const expect: Expect = { selected, style: (s) => ({ ...s, link: url }), blocks: [bi] };
  let reason = "the link could not be written safely";
  for (const t of candidates) {
    const r = checkLink(m, t, expect);
    if (r === null) {
      const nm = buildModel(t);
      const idx = [...selected].sort((x, y) => x - y);
      return { ok: true, text: t, from: nm.chars[idx[0]].start, to: nm.chars[idx[idx.length - 1]].end, skipped: { count: 0, reasons: [] }, applied: idx };
    }
    reason = r;
  }
  return { ok: false, reason };
}

/** The check, with links allowed to change for the selected characters. */
function checkLink(m: Model, t: string, e: Expect): string | null {
  // check() compares links of all characters; for a link command the selected ones change, so
  // compare with the link folded into the expected style.
  const altered: Model = { ...m, chars: m.chars.map((c, i) => (e.selected.has(i) ? { ...c, style: e.style(c.style, i) } : c)) };
  return check(altered, t, { ...e, style: (s) => s });
}

// --------------------------------------------------------------------------------------------
// Clear formatting

function clearFormatting(text: string, from: number, to: number): Result {
  const steps: Change[] = [
    { kind: "color", value: null },
    { kind: "bg", value: null },
    { kind: "font", value: null },
    { kind: "underline", on: false },
    { kind: "bold", on: false },
    { kind: "italic", on: false },
    { kind: "strike", on: false },
  ];
  let cur = text;
  let f = from;
  let t = to;
  const reasons: string[] = [];
  let changed = false;
  const applied = new Set<number>();
  // Size goes to each block's normal size.
  const m0 = buildModel(text);
  const sel0 = selectedChars(m0, from, to);
  const sizeSteps: Change[] = [];
  const naturals = new Set(sel0.map((i) => natural(m0, m0.blocks[m0.chars[i].block])));
  for (const pt of naturals) sizeSteps.push({ kind: "size", pt });
  for (const step of [...steps, ...sizeSteps]) {
    const m = buildModel(cur);
    const sel = selectedChars(m, f, t);
    // Only where something is to be cleared.
    if (step.kind === "size") {
      const blocksAt = new Set(sel.filter((i) => Math.abs(natural(m, m.blocks[m.chars[i].block]) - step.pt) < 1e-6).map((i) => m.chars[i].block));
      if (blocksAt.size === 0 || sel.every((i) => !blocksAt.has(m.chars[i].block) || Math.abs(m.chars[i].style.size - step.pt) < 1e-6)) continue;
      for (const bi of [...blocksAt].sort((x, y) => y - x)) {
        const idx = sel.filter((i) => m.chars[i].block === bi);
        const mm = buildModel(cur);
        const r = applyStyle(cur, mm.chars[idx[0]].start, mm.chars[idx[idx.length - 1]].end, step);
        if (r.ok) {
          if (r.text !== cur) changed = true;
          cur = r.text;
          for (const i of r.applied) applied.add(i);
        } else reasons.push(r.reason);
      }
      const nm = buildModel(cur);
      f = nm.chars[sel[0]].start;
      t = nm.chars[sel[sel.length - 1]].end;
      continue;
    }
    const r = applyStyle(cur, f, t, step);
    if (r.ok) {
      if (r.text !== cur) changed = true;
      cur = r.text;
      f = r.from;
      t = r.to;
      for (const i of r.applied) applied.add(i);
      reasons.push(...r.skipped.reasons);
    } else reasons.push(r.reason);
  }
  if (!changed && reasons.length) return { ok: false, reason: reasons[0] };
  return { ok: true, text: cur, from: f, to: t, skipped: { count: reasons.length, reasons: [...new Set(reasons)] }, applied: [...applied].sort((x, y) => x - y) };
}
