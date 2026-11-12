// The building blocks of the style commands (EDITOR-PLAN 5.3, 5.4): a patch of insertions and
// replacements, the places a visible boundary can be written at, and the attribute list text.

import type { INode, Model } from "./model.ts";

/** Insertions and replacements on a text, applied together. */
export class Patch {
  #ops: { start: number; end: number; text: string; order: number }[] = [];
  #n = 0;

  /** Inserts `text` at `pos`. At one position, insertions keep the order they were made in. */
  insert(pos: number, text: string): this {
    if (text !== "") this.#ops.push({ start: pos, end: pos, text, order: this.#n++ });
    return this;
  }

  replace(start: number, end: number, text: string): this {
    this.#ops.push({ start, end, text, order: this.#n++ });
    return this;
  }

  get empty(): boolean {
    return this.#ops.length === 0;
  }

  apply(text: string): string | null {
    const ops = [...this.#ops].sort((a, b) => a.start - b.start || a.end - b.end || a.order - b.order);
    let out = "";
    let pos = 0;
    for (const op of ops) {
      if (op.start < pos) return null; // overlapping edits: not a candidate
      out += text.slice(pos, op.start) + op.text;
      pos = op.end;
    }
    return out + text.slice(pos);
  }
}

/** A place a boundary can be written at: a source position, and the elements open there. */
export interface Place {
  pos: number;
  /** Elements the place is inside of, below the scope, outermost first. */
  crossed: INode[];
}

const ATOMIC = new Set(["code", "image", "soft", "hard"]);

function atomic(n: INode): boolean {
  return ATOMIC.has(n.kind) || (n.kind === "link" && (n.linkKind === "bare" || n.linkKind === "autolink"));
}

/**
 * The places where a selection starting at visible character `k` can begin, in `scope`,
 * outermost first. Empty when `k` falls inside something that cannot be divided (a code span,
 * a bare web address).
 */
export function startPlaces(m: Model, scope: INode[], k: number): Place[] {
  for (const c of scope) {
    if (k < c.va || k >= c.vb) continue;
    if (c.kind === "text") return [{ pos: m.chars[k].start, crossed: [] }];
    if (k === c.va) {
      const out: Place[] = [{ pos: c.start, crossed: [] }];
      if (!atomic(c) && c.kind !== "span") for (const p of startPlaces(m, c.children, k)) out.push({ pos: p.pos, crossed: [c, ...p.crossed] });
      return out;
    }
    if (atomic(c) || c.kind === "span") return [];
    return startPlaces(m, c.children, k).map((p) => ({ pos: p.pos, crossed: [c, ...p.crossed] }));
  }
  return [];
}

/** The places where a selection ending before visible character `k` can end, outermost first. */
export function endPlaces(m: Model, scope: INode[], k: number): Place[] {
  for (const c of scope) {
    if (k - 1 < c.va || k - 1 >= c.vb) continue;
    if (c.kind === "text") return [{ pos: m.chars[k - 1].end, crossed: [] }];
    if (k === c.vb) {
      const out: Place[] = [{ pos: c.end, crossed: [] }];
      if (!atomic(c) && c.kind !== "span") for (const p of endPlaces(m, c.children, k)) out.push({ pos: p.pos, crossed: [c, ...p.crossed] });
      return out;
    }
    if (atomic(c) || c.kind === "span") return [];
    return endPlaces(m, c.children, k).map((p) => ({ pos: p.pos, crossed: [c, ...p.crossed] }));
  }
  return [];
}

/** The pairs of start and end places, those needing the fewest elements closed first. */
export function placePairs(starts: Place[], ends: Place[]): { s: Place; e: Place; common: number }[] {
  const out: { s: Place; e: Place; common: number; cost: number; depth: number }[] = [];
  for (const s of starts) {
    for (const e of ends) {
      let common = 0;
      while (common < s.crossed.length && common < e.crossed.length && s.crossed[common] === e.crossed[common]) common++;
      const cost = s.crossed.length - common + (e.crossed.length - common);
      out.push({ s, e, common, cost, depth: common });
    }
  }
  return out.sort((a, b) => a.cost - b.cost || a.depth - b.depth);
}

export function openText(text: string, n: INode): string {
  return text.slice(n.start, n.contentStart);
}

export function closeText(text: string, n: INode): string {
  return text.slice(n.contentEnd, n.end);
}

const MOVES_SPACES = new Set(["emphasis", "strong", "strike", "underline", "highlight"]);

/**
 * Writes, at a boundary, the closing delimiters of `els` (innermost first), then `middle`, then
 * their opening delimiters again (outermost first). A delimiter of emphasis or a mark cannot
 * close after a space or open before one, so spaces are moved outside it.
 */
export function writeBoundary(p: Patch, text: string, pos: number, els: INode[], middle: string): void {
  const closes = [...els].reverse();
  for (const e of closes) {
    let q = pos;
    if (MOVES_SPACES.has(e.kind)) while (q > e.contentStart && text[q - 1] === " ") q--;
    p.insert(q, closeText(text, e));
  }
  p.insert(pos, middle);
  // Opening delimiters go after the boundary; spaces right after it are moved before them.
  for (const e of els) {
    let q = pos;
    if (MOVES_SPACES.has(e.kind)) while (q < e.contentEnd && text[q] === " ") q++;
    if (q === pos) p.insert(pos, openText(text, e));
    else p.insert(q, openText(text, e));
  }
}

// --- attribute lists --------------------------------------------------------------------------

/** A value as written in an attribute list: quoted unless it is a bare word. */
export function attrValue(v: string): string {
  if (/^[A-Za-z0-9#_.%-]+$/.test(v)) return v;
  return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

/**
 * The text of an attribute list with `key` set to `value` (on its last occurrence; added at
 * the end when absent) or, with `value` null, with every occurrence removed. Null when no
 * attribute is left.
 */
export function editAttrs(text: string, attrs: NonNullable<INode["attrs"]>, key: string, value: string | null): string | null {
  const src = text.slice(attrs.start, attrs.end);
  const base = attrs.start;
  const occ = attrs.list.filter((a) => a.key === key);
  if (value === null) {
    let out = src;
    for (const a of [...occ].reverse()) {
      let s = a.start - base;
      let e = a.end - base;
      // Take one neighbouring space with it.
      if (out[e] === " ") e++;
      else if (out[s - 1] === " ") s--;
      out = out.slice(0, s) + out.slice(e);
    }
    out = out.replace(/^\{\s+/, "{").replace(/\s+\}$/, "}");
    return attrs.list.length === occ.length ? null : out;
  }
  const kv = `${key}=${attrValue(value)}`;
  if (occ.length) {
    const last = occ[occ.length - 1];
    return src.slice(0, last.start - base) + kv + src.slice(last.end - base);
  }
  const inner = src.slice(1, -1);
  return "{" + inner + (inner.trim() === "" ? "" : " ") + kv + "}";
}

/** Escapes the characters of a visible text so that none acts as markup. */
export function escapeText(s: string): string {
  return s.replace(/[\\`*_[\]{}<>()#+\-.!|~=&"']/g, (c) => "\\" + c);
}

/** Escapes what could act as markup inside link text (not `.`, `/`, `:` and the like). */
export function escapeLinkText(s: string): string {
  return s.replace(/[\\`*_[\]{}<>!&~=+]/g, (c) => "\\" + c);
}

/** A destination written so it parses back as itself. */
export function writeDest(d: string): string {
  if (/^[^\s()<>\\]+$/.test(d)) return d;
  return "<" + d.replace(/[<>\\]/g, (c) => "\\" + c) + ">";
}
