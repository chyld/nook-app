// A test-only checker for the style commands (EDITOR-PLAN 8): the five checks of 5.1, written
// independently of shared/style/check.ts and of noteformat's styleRuns, so that a mistake in
// one is caught by the other. It walks the parser's tree itself, works out every character's
// look by its own reading of SPEC 5.5, and judges locality from a plain text diff.

import { parseNote, type Block, type Inline } from "../../../noteformat/src/index.ts";

// Its own tables (SPEC 5.3 and EDITOR-PLAN 4), not imported.
const NAMED: Record<string, number> = { xs: 0.75, small: 0.875, normal: 1, large: 1.25, xl: 1.5, xxl: 2 };
const HEAD = [24, 18, 14, 12, 11, 10].map((p) => p / 12);
const PALETTE = new Set(["red", "orange", "yellow", "green", "mint", "teal", "blue", "indigo", "purple", "pink", "brown", "gray", "black", "white"]);

export interface OChar {
  ch: string;
  kind: string;
  block: number;
  look: OLook;
}

export interface OLook {
  b: boolean;
  i: boolean;
  s: boolean;
  code: boolean;
  u: boolean;
  color: string;
  bg: string;
  font: string;
  size: number;
  link: string;
  image: string;
}

export interface OBlock {
  desc: string;
  start: number;
  end: number;
}

function size(v: string | undefined, base: number): number | null {
  if (v === undefined) return null;
  const low = v.toLowerCase();
  if (low in NAMED) return base * NAMED[low];
  let m = /^(\d+)px$/.exec(v);
  if (m && +m[1] >= 6 && +m[1] <= 200) return +m[1] * 0.75;
  m = /^([1-9]\d{0,2}(?:\.\d)?)pt$/.exec(v);
  if (m && +m[1] >= 1 && +m[1] <= 400) return +m[1];
  return null;
}

function colour(v: string | undefined, allowHighlight: boolean): string | null {
  if (v === undefined) return null;
  const low = v.toLowerCase();
  if (PALETTE.has(low) || (allowHighlight && low === "highlight")) return low;
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) return v.toLowerCase();
  return null;
}

/** The last valid value of each key of an attribute list (SPEC 5.3), its own reading. */
function attrs(list: { key: string; value: string }[]): Record<string, string> {
  const last: Record<string, string> = {};
  for (const a of list) last[a.key] = a.value;
  const out: Record<string, string> = {};
  if (last.color !== undefined && colour(last.color, false)) out.color = colour(last.color, false)!;
  if (last.bg !== undefined && colour(last.bg, true)) out.bg = colour(last.bg, true)!;
  if (last.font !== undefined && last.font.trim() !== "") out.font = last.font;
  if (last.size !== undefined && size(last.size, 1) !== null) out.size = last.size;
  if (last.underline !== undefined && /^(yes|no)$/i.test(last.underline)) out.underline = last.underline.toLowerCase();
  return out;
}

export function oracleChars(text: string): { chars: OChar[]; blocks: OBlock[] } {
  const note = parseNote(text);
  const fm = note.frontMatter?.fields ?? {};
  const noteSize = size(fm.size, 12) ?? 12;
  const chars: OChar[] = [];
  const blocks: OBlock[] = [];
  const doBlock = (desc: string, start: number, end: number) => {
    blocks.push({ desc, start, end });
    return blocks.length - 1;
  };
  interface Ctx {
    b: boolean;
    i: boolean;
    s: boolean;
    u: boolean;
    hl: boolean;
    span: Record<string, string> | null;
    link: string;
  }
  const look = (c: Ctx, line: Record<string, string>, blockSize: number, code: boolean): OLook => {
    const sp = c.span ?? {};
    let u = false;
    if (c.u) u = true;
    else if (sp.underline) u = sp.underline === "yes";
    else if (line.underline) u = line.underline === "yes";
    let bg = "";
    if (sp.bg) bg = sp.bg;
    else if (c.hl) bg = "highlight";
    else if (line.bg) bg = line.bg;
    let font = "";
    if (sp.font) font = sp.font;
    else if (line.font) font = line.font;
    else if (!code && fm.font) font = fm.font;
    return {
      b: c.b,
      i: c.i,
      s: c.s,
      code,
      u,
      color: sp.color ?? line.color ?? "",
      bg,
      font,
      size: size(sp.size, blockSize) ?? blockSize,
      link: c.link,
      image: "",
    };
  };
  const inl = (nodes: readonly Inline[], c: Ctx, bi: number, line: Record<string, string>, bs: number, width: string) => {
    for (const n of nodes) {
      if (n.type === "text") for (const ch of n.value) chars.push({ ch, kind: "t", block: bi, look: look(c, line, bs, false) });
      else if (n.type === "code") for (const ch of n.value) chars.push({ ch, kind: "t", block: bi, look: look(c, line, bs, true) });
      else if (n.type === "softBreak") chars.push({ ch: " ", kind: "soft", block: bi, look: look(c, line, bs, false) });
      else if (n.type === "hardBreak") chars.push({ ch: "\n", kind: "hard", block: bi, look: look(c, line, bs, false) });
      else if (n.type === "image") chars.push({ ch: "￼", kind: "img", block: bi, look: { ...look(c, line, bs, false), image: `${n.destination}|${n.alt}|${width}` } });
      else if (n.type === "strong") inl(n.children, { ...c, b: true }, bi, line, bs, width);
      else if (n.type === "emphasis") inl(n.children, { ...c, i: true }, bi, line, bs, width);
      else if (n.type === "strikethrough") inl(n.children, { ...c, s: true }, bi, line, bs, width);
      else if (n.type === "underline") inl(n.children, { ...c, u: true }, bi, line, bs, width);
      else if (n.type === "highlight") inl(n.children, { ...c, hl: true }, bi, line, bs, width);
      else if (n.type === "span") inl(n.children, { ...c, span: attrs(n.attributes.attributes) }, bi, line, bs, width);
      else if (n.type === "link") inl(n.children, { ...c, link: n.destination }, bi, line, bs, width);
    }
  };
  const none: Ctx = { b: false, i: false, s: false, u: false, hl: false, span: null, link: "" };
  const walk = (bs: readonly Block[], where: string) => {
    for (const b of bs) {
      if (b.type === "paragraph" || b.type === "heading") {
        const isImage = b.attributes?.target === "image";
        const line = b.attributes && !isImage ? attrs(b.attributes.list.attributes) : {};
        const width = isImage ? (b.attributes!.list.attributes.filter((a) => a.key === "width").pop()?.value ?? "") : "";
        const base = b.type === "heading" ? noteSize * HEAD[b.level - 1] : noteSize;
        const bsz = size(line.size, base) ?? base;
        const end = b.attributes ? Math.max(b.range.end, b.attributes.range.end) : b.range.end;
        const bi = doBlock(`${where}>${b.type}${b.type === "heading" ? b.level : ""}`, b.range.start, end);
        inl(b.children, none, bi, line, bsz, width);
      } else if (b.type === "blockQuote") walk(b.children, `${where}>q`);
      else if (b.type === "list") b.children.forEach((it, k) => walk(it.children, `${where}>${b.ordered ? "ol" : "ul"}${k}${it.task ? (it.task.checked ? "x" : "o") : ""}`));
      else if (b.type === "codeBlock") {
        const bi = doBlock(`${where}>code`, b.range.start, b.range.end);
        for (const ch of b.value) chars.push({ ch, kind: "t", block: bi, look: { ...look(none, {}, noteSize, true) } });
      } else if (b.type === "thematicBreak") doBlock(`${where}>hr`, b.range.start, b.range.end);
      else if (b.type === "table") {
        [b.head, ...b.body].forEach((row, r) =>
          row.cells.forEach((cell, k) => {
            const bi = doBlock(`${where}>t${r},${k}`, cell.range.start, cell.range.end);
            inl(cell.children, none, bi, {}, noteSize, "");
          }),
        );
      }
    }
  };
  walk(note.children, "");
  return { chars, blocks };
}

export type OChange =
  | { prop: "color" | "bg"; value: string | null }
  | { prop: "font"; value: string | null }
  | { prop: "size"; value: number }
  | { prop: "step"; dir: 1 | -1 }
  | { prop: "u" | "b" | "i" | "s" | "code"; value: boolean }
  | { prop: "link"; value: string | null }
  | { prop: "clear" };

// SPEC2 1.3: a step is 1 point from the character's own size, within 1 to 400.
function step(sz: number, dir: 1 | -1): number {
  return Math.max(1, Math.min(400, Math.round((sz + dir) * 10) / 10));
}

function lookKey(l: OLook, ws: boolean): string {
  return [ws ? "" : l.b, ws ? "" : l.i, l.s, l.code, l.u, l.color, l.bg, l.font, Math.round(l.size * 1000), l.link, l.image].join("|");
}

/**
 * Judges a command's result. `sel` is the visible range the command applied to. Returns null
 * when the result is correct, or what is wrong.
 */
export function judge(oldText: string, newText: string, sel: [number, number], change: OChange, noteFont: string | null, naturalSize?: (block: number) => number): string | null {
  const o = oracleChars(oldText);
  const n = oracleChars(newText);
  // 1. Visible characters, blocks, breaks, links, images, code.
  if (o.chars.length !== n.chars.length) return `visible length ${o.chars.length} → ${n.chars.length}`;
  if (o.blocks.map((b) => b.desc).join() !== n.blocks.map((b) => b.desc).join()) return "blocks changed";
  for (let k = 0; k < o.chars.length; k++) {
    const x = o.chars[k];
    const y = n.chars[k];
    const inSel = k >= sel[0] && k < sel[1];
    if (x.ch !== y.ch || x.kind !== y.kind || x.block !== y.block) return `character ${k} changed`;
    if (x.look.image !== y.look.image) return `image ${k} changed`;
    if (!inSel || change.prop !== "link") if (x.look.link !== y.look.link) return `link of ${k} changed`;
    if (!inSel || change.prop !== "code") if (x.look.code !== y.look.code) return `code of ${k} changed`;
  }
  // 2 and 3.
  for (let k = 0; k < o.chars.length; k++) {
    const x = o.chars[k];
    const inSel = k >= sel[0] && k < sel[1];
    let want: OLook = x.look;
    if (inSel) {
      want = { ...x.look };
      switch (change.prop) {
        case "color":
          want.color = change.value ?? "";
          break;
        case "bg":
          want.bg = change.value ?? "";
          break;
        case "font":
          want.font = change.value ?? (x.look.code ? "" : (noteFont ?? ""));
          break;
        case "size":
          want.size = change.value;
          break;
        case "step":
          want.size = step(x.look.size, change.dir);
          break;
        case "u":
          want.u = change.value;
          break;
        case "b":
          want.b = change.value;
          break;
        case "i":
          want.i = change.value;
          break;
        case "s":
          want.s = change.value;
          break;
        case "code":
          want.code = change.value;
          break;
        case "link":
          want.link = change.value ?? "";
          break;
        case "clear":
          want = { ...want, color: "", bg: "", font: x.look.code ? "" : (noteFont ?? ""), u: false, b: false, i: false, s: false, size: naturalSize ? naturalSize(x.block) : want.size };
          break;
      }
    }
    const ws = /\s/.test(x.ch);
    if (lookKey(want, ws) !== lookKey(n.chars[k].look, ws)) return `${inSel ? "selected" : "unselected"} character ${k} "${x.ch}" looks wrong`;
  }
  // 5. Locality: what lies before and after the touched blocks is byte for byte the same.
  if (oldText === newText) return null;
  const touched = new Set(o.chars.slice(sel[0], sel[1]).map((c) => c.block));
  let lo = Infinity;
  let hi = -Infinity;
  for (const bi of touched) {
    lo = Math.min(lo, o.blocks[bi].start);
    hi = Math.max(hi, o.blocks[bi].end);
  }
  if (newText.slice(0, lo) !== oldText.slice(0, lo)) return `the text before the touched blocks changed`;
  const tail = oldText.length - hi;
  if (newText.length < tail || newText.slice(newText.length - tail) !== oldText.slice(hi)) return `the text after the touched blocks changed`;
  return null;
}

/**
 * The source offsets of visible boundaries, found without the commands' own mapping: a private
 * character is put at each source position, and a position counts as the boundary before
 * visible character k when the note still reads the same apart from that character.
 */
export function boundaries(text: string): Map<number, number> {
  const base = oracleChars(text).chars.map((c) => c.ch).join("");
  const out = new Map<number, number>(); // visible index → first clean source position
  for (let pos = 0; pos <= text.length; pos++) {
    const t = text.slice(0, pos) + "" + text.slice(pos);
    const shown = oracleChars(t).chars.map((c) => c.ch).join("");
    const k = shown.indexOf("");
    if (k < 0) continue;
    if (shown.slice(0, k) + shown.slice(k + 1) !== base) continue;
    if (!out.has(k)) out.set(k, pos);
  }
  return out;
}
