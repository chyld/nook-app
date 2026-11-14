// Typing, deleting, Enter and pasting in rich mode (EDITOR-PLAN 3.2, 3.4, 5): every edit is an
// edit to the raw text, tried at each place the hidden markup allows and kept only when the
// check passes: the visible text changes by exactly what was typed or deleted, and nothing else
// changes. Typing tries the raw characters first and escaped ones second. Pure functions.

import { styleKey, type RunStyle, type VisibleChar } from "../../../../noteformat/src/index.ts";
import { allNodes, buildModel, type BlockModel, type INode, type Model } from "./model.ts";
import { applyStyle, type Change } from "./apply.ts";
import { escapeText } from "./edits.ts";
import { setBlockStyle, toggleList, type ListKind } from "./blocks.ts";
import { isBlank, isMdSpace, plainSpaces } from "./blank.ts";
import { bodyStart } from "../region.ts";

export type Edit = { ok: true; text: string; cursor: number; anchor?: number; styleDiffers?: boolean } | { ok: false; reason: string };

/** White space of any kind: a mark (bold, italic) does not show on it, and it separates words. */
const isWs = (ch: string) => /^\s$/u.test(ch);

/**
 * The characters of bare web addresses and autolinks: their text is their link, so editing one
 * of their characters changes the link of all of them (EDITOR-ISSUES, bare addresses).
 */
const bareCache = new WeakMap<Model, Set<number>>();
function bare(m: Model): Set<number> {
  let s = bareCache.get(m);
  if (!s) {
    s = new Set<number>();
    for (const b of m.blocks) for (const n of allNodes(b.root)) if (n.kind === "link" && (n.linkKind === "bare" || n.linkKind === "autolink")) for (let x = n.va; x < n.vb; x++) s.add(x);
    bareCache.set(m, s);
  }
  return s;
}

/** The same character's style in two models, allowing a bare address's link to change. */
function sameLook(om: Model, oi: number, nm: Model, ni: number, drop: (keyof RunStyle)[] = []): boolean {
  const d = bare(om).has(oi) || bare(nm).has(ni) ? [...drop, "link" as const] : drop;
  return norm(om.chars[oi], d) === norm(nm.chars[ni], d);
}

/** A character's style as the check compares it: bold and italic do not show on a space. */
function norm(c: VisibleChar, drop: (keyof RunStyle)[] = []): string {
  const s = { ...c.style } as Record<string, unknown>;
  if (isWs(c.ch)) {
    s.bold = false;
    s.italic = false;
  }
  for (const k of drop) s[k] = null;
  return c.kind + "\u0000" + styleKey(s as unknown as RunStyle);
}

function lineStartOf(text: string, pos: number): number {
  let s = pos;
  while (s > 0 && text[s - 1] !== "\n" && text[s - 1] !== "\r") s--;
  return s;
}

function lineEndOf(text: string, pos: number): number {
  let e = pos;
  while (e < text.length && text[e] !== "\n" && text[e] !== "\r") e++;
  return e;
}

function attrEnd(b: BlockModel): number {
  const pb = b.block as { attributes?: { range: { end: number } } } | null;
  return pb && "attributes" in pb && pb.attributes ? Math.max(pb.attributes.range.end, b.info.range.end) : b.info.range.end;
}

/** Where a block's lines start and end in the source: its prefix, content and attribute line. */
function region(text: string, b: BlockModel): [number, number] {
  if (b.info.kind === "cell") return [b.info.range.start, b.info.range.end];
  return [lineStartOf(text, b.info.range.start), attrEnd(b)];
}

/** The block the position is in, or null on a line between blocks. */
export function blockAt(m: Model, p: number): BlockModel | null {
  for (const b of m.blocks) {
    const [a, e] = region(m.text, b);
    if (p >= a && p <= e) return b;
  }
  return null;
}

/** The visible index of the position: how many characters come before it. */
function indexAt(m: Model, p: number, b: BlockModel | null): number {
  let k = 0;
  while (k < m.chars.length && m.chars[k].end <= p && !(m.chars[k].start >= p)) k++;
  if (b) k = Math.max(b.va, Math.min(b.vb, k));
  return k;
}

/** Where the text after the front matter starts: the front matter and the one blank line after
 *  it are hidden; further blank lines are shown and can be deleted (change 13; review of alpha's
 *  changes, 9). */
function contentStart(m: Model): number {
  return bodyStart(m);
}

/** Places in [lo, hi] worth trying: the ends, the cursor, and every markup boundary between. */
function places(m: Model, lo: number, hi: number, p: number): number[] {
  const set = new Set<number>([p, lo, hi]);
  for (const b of m.blocks) {
    for (const n of allNodes(b.root)) for (const x of [n.start, n.contentStart, n.contentEnd, n.end]) if (x >= lo && x <= hi) set.add(x);
  }
  // Line starts and ends in the gap (block lines, attribute lines).
  for (let x = lo; x <= hi; x++) if (x === lo || m.text[x - 1] === "\n" || m.text[x] === "\n") set.add(x);
  return [...set].filter((x) => x >= lo && x <= hi).sort((a, b) => Math.abs(a - p) - Math.abs(b - p) || a - b);
}

/** The edits to try to write `s` as visible text: raw, then escaped, then every punctuation escaped. */
function encodings(s: string): string[] {
  const out = [s, escapeText(s), s.replace(/[!-/:-@[-`{-~]/g, (c) => "\\" + c)];
  return [...new Set(out)];
}

interface Judged {
  ok: boolean;
  /** Properties of the new characters that differ from the wanted style. */
  diffs: (keyof RunStyle)[];
  model: Model;
}

type Group = "prev" | "next" | "own";

/**
 * Judges an insertion of visible `ins` at visible index k: the visible text is the old one with
 * `ins` at k, the old characters keep their style and their grouping into blocks, and the new
 * characters join the block of their neighbour (or form a block of their own).
 */
function judgeInsert(old: Model, newText: string, k: number, ins: string, group: Group, want: RunStyle | null): Judged {
  const nm = buildModel(newText);
  const fail = { ok: false, diffs: [], model: nm };
  const d = nm.chars.length - old.chars.length;
  if (d <= 0) return fail;
  const ov = old.chars.map((c) => c.ch);
  const expect = ov.slice(0, k).join("") + ins + ov.slice(k).join("");
  if (nm.chars.map((c) => c.ch).join("") !== expect) return fail;
  const at = (i: number) => (i < k ? i : i + d);
  for (let i = 0; i < old.chars.length; i++) if (!sameLook(old, i, nm, at(i))) return fail;
  for (let i = 0; i + 1 < old.chars.length; i++) {
    if ((old.chars[i].block === old.chars[i + 1].block) !== (nm.chars[at(i)].block === nm.chars[at(i + 1)].block)) return fail;
  }
  const nb = nm.chars[k].block;
  for (let i = k; i < k + d; i++) if (nm.chars[i].block !== nb || nm.chars[i].kind !== "text") return fail;
  const prev = k > 0 ? nm.chars[k - 1].block : -1;
  const next = k + d < nm.chars.length ? nm.chars[k + d].block : -1;
  if (group === "prev" && prev !== nb) return fail;
  if (group === "next" && next !== nb) return fail;
  if (group === "own" && (prev === nb || next === nb)) return fail;
  const diffs = new Set<keyof RunStyle>();
  if (want) {
    for (let i = k; i < k + d; i++) {
      const c = nm.chars[i];
      for (const key of Object.keys(want) as (keyof RunStyle)[]) {
        if ((key === "bold" || key === "italic") && isWs(c.ch)) continue;
        if (key === "link" && bare(nm).has(i)) continue;
        if (want[key] !== c.style[key]) diffs.add(key);
      }
    }
  }
  return { ok: true, diffs: [...diffs], model: nm };
}

/** The change that gives the new characters the wanted value of one property. */
function fixFor(key: keyof RunStyle, want: RunStyle): Change | null {
  switch (key) {
    case "bold":
    case "italic":
    case "strike":
      return { kind: key, on: want[key] };
    case "underline":
      return { kind: "underline", on: want.underline };
    case "color":
    case "bg":
    case "font":
      return { kind: key, value: want[key] };
    case "size":
      return { kind: "size", pt: want.size };
    default:
      return null;
  }
}

/** Applies style changes to the visible characters [k, k+d) of a text. */
function restyle(text: string, k: number, d: number, changes: Change[]): { text: string; ok: boolean } {
  let t = text;
  let ok = true;
  for (const ch of changes) {
    const m = buildModel(t);
    const r = applyStyle(t, m.chars[k].start, m.chars[k + d - 1].end, ch);
    if (r.ok) t = r.text;
    else ok = false;
  }
  return { text: t, ok };
}

/**
 * Typing: replaces the selection [from, to) with `ins` (one line of text). The new characters
 * take the style of the character before them (at a block's start, the one after), then each
 * pending change.
 */
export function typeText(text: string, from: number, to: number, ins: string, pending: Change[] = []): Edit {
  if (ins === "") return from === to ? { ok: true, text, cursor: from } : deleteRange(text, from, to);
  if (/[\r\n]/.test(ins)) return pastePlain(text, from, to, ins);
  if (from !== to) {
    // Version 2 (a scenario of SPEC2 12): first the selected characters replaced where they
    // are. Deleting first can leave a space at the start of a paragraph, where it does not show,
    // and the typed text then went in after it ("Hi there", "Hi" selected, x: "xthere").
    const over = typeOver(text, from, to, ins, pending);
    if (over) return over;
    const d = deleteRange(text, from, to);
    if (!d.ok) return d;
    text = d.text;
    from = to = d.cursor;
  }
  let m = buildModel(text);
  const b = blockAt(m, from);
  if (b && b.info.kind === "code") return typeInCode(m, b, from, ins);
  const k = indexAt(m, from, b);
  // Spaces at the end of a paragraph do not show until text follows them: a typed space there
  // is kept as it is, and the next character typed brings it in (EDITOR-ISSUES, trailing spaces).
  if (b && b.vb > b.va && k === b.vb) {
    const ws = /[ \t]*$/.exec(text.slice(m.chars[k - 1].end, from))![0];
    if (/^[ \t]+$/.test(ins)) {
      // At the cursor, or after the markup that closes the text there (`**bold**` then a space:
      // the space goes after the stars, where it stays hidden until a letter follows).
      let lineEnd = from;
      while (lineEnd < text.length && text[lineEnd] !== "\n" && text[lineEnd] !== "\r") lineEnd++;
      // Only those two places: anywhere between could be inside the markup itself.
      for (const q of from === lineEnd ? [from] : [from, lineEnd]) {
        const t = text.slice(0, q) + ins + text.slice(q);
        if (visibleSame(m, t)) return { ok: true, text: t, cursor: q + ins.length };
      }
    } else if (ws) {
      text = text.slice(0, from - ws.length) + text.slice(from);
      from -= ws.length;
      ins = ws + ins;
      m = buildModel(text);
    }
  }

  let group: Group;
  let want: RunStyle | null;
  let lo: number;
  let hi: number;
  if (b && b.vb > b.va) {
    const atStart = k === b.va;
    const near = atStart ? m.chars[k] : m.chars[k - 1];
    group = atStart ? "next" : "prev";
    want = { ...near.style, link: null, code: near.style.code };
    lo = atStart ? region(text, b)[0] : m.chars[k - 1].end;
    hi = k < b.vb ? m.chars[k].start : b.info.range.end;
    // Typing right after a link does not extend it, as in Google Docs; inside it, it does.
    if (!atStart && k < b.vb && m.chars[k].style.link === near.style.link) want.link = near.style.link;
    if (atStart) want.link = near.style.link && k > 0 && m.chars[k - 1].style.link === near.style.link ? near.style.link : null;
  } else {
    // An empty block (an empty heading or list item) or a line between blocks: a new block.
    group = "own";
    want = null;
    lo = hi = from;
  }
  let best: { text: string; diffs: (keyof RunStyle)[] } | null = null;
  const tries: string[] = [];
  for (const enc of encodings(ins)) {
    for (const q of places(m, lo, hi, from)) {
      if (group === "own") {
        // A new paragraph needs blank lines around it, unless it is in an empty block.
        const around = b ? [["", ""]] : [["", ""], ["\n", ""], ["", "\n"], ["\n", "\n"]];
        for (const [x, y] of around) tries.push(text.slice(0, q) + x + enc + y + text.slice(q));
      } else tries.push(text.slice(0, q) + enc + text.slice(q));
    }
    for (const t of tries) {
      const j = judgeInsert(m, t, k, ins, group, want);
      if (!j.ok) continue;
      if (j.diffs.length === 0) return finishTyping(t, k, j.model.chars.length - m.chars.length, j.model, pending, false);
      if (!best || j.diffs.length < best.diffs.length) best = { text: t, diffs: j.diffs };
    }
    if (best) break;
    tries.length = 0;
  }
  // The character before may need escaping now (`#` then a space would make a heading).
  if (!best && group === "prev" && k > b!.va) {
    const pc = m.chars[k - 1];
    if (/^[!-/:-@[-`{-~]$/.test(pc.ch) && text.slice(pc.start, pc.end) === pc.ch) {
      for (const enc of encodings(ins)) {
        const t = text.slice(0, pc.start) + "\\" + pc.ch + enc + text.slice(pc.end);
        const j = judgeInsert(m, t, k, ins, group, want);
        if (!j.ok) continue;
        if (j.diffs.length === 0) return finishTyping(t, k, j.model.chars.length - m.chars.length, j.model, pending, false);
        if (!best) best = { text: t, diffs: j.diffs };
      }
    }
  }
  if (!best) return { ok: false, reason: "this character cannot be typed here; type it in Raw" };
  // Give the new characters the wanted style, property by property.
  const fixes = best.diffs.map((key) => fixFor(key, want!)).filter((c): c is Change => c !== null);
  const d = buildModel(best.text).chars.length - m.chars.length;
  const r = restyle(best.text, k, d, fixes);
  const after = buildModel(r.text);
  const differs = !r.ok || best.diffs.some((key) => key !== "link" && key !== "code" && after.chars.slice(k, k + d).some((c) => !(isWs(c.ch) && (key === "bold" || key === "italic")) && c.style[key] !== want![key]));
  return finishTyping(r.text, k, d, after, pending, differs);
}

/**
 * Typing over a selection within one block: the source of the selected visible characters is
 * replaced by the typed text (as typed, then escaped), kept only when the visible text is the old
 * one with the selection replaced, every other character keeps its look and its block, and the
 * typed characters take the look of the first selected one. Null when no candidate passes.
 */
function typeOver(text: string, from: number, to: number, ins: string, pending: Change[]): Edit | null {
  const m = buildModel(text);
  const sel = m.chars.map((c, n) => (c.start >= from && c.end <= to ? n : -1)).filter((n) => n >= 0);
  if (sel.length === 0) return null;
  const i = sel[0];
  const j = sel[sel.length - 1] + 1;
  if (j - i !== sel.length || m.chars[i].block !== m.chars[j - 1].block) return null;
  if (m.chars.slice(i, j).some((c) => c.kind !== "text")) return null;
  const b = m.blocks[m.chars[i].block];
  if (b.info.kind === "code" || b.info.kind === "cell") return null;
  const want = m.chars[i].style;
  const ov = m.chars.map((c) => c.ch);
  const expect = ov.slice(0, i).join("") + ins + ov.slice(j).join("");
  // The source replaced: that of the selected characters; failing that, widened over the hidden
  // markup at either end (a selection that ends inside `~~beta~~` leaves a lone `~~` otherwise;
  // found by the generated test of the code review's finding 38). The checks below judge each.
  const near = (x: number) => x >= 0 && x < m.chars.length && m.chars[x].block === m.chars[i].block;
  const starts = [m.chars[i].start, near(i - 1) ? m.chars[i - 1].end : Math.min(b.info.range.start, m.chars[i].start)];
  // At the block's end: the end of the last character's line, not the attribute line after it.
  const lineEnd = (p: number) => {
    const n = text.indexOf("\n", p);
    return n < 0 ? text.length : n;
  };
  const ends = [m.chars[j - 1].end, near(j) ? m.chars[j].start : Math.max(Math.min(b.info.range.end, lineEnd(m.chars[j - 1].end)), m.chars[j - 1].end)];
  const spans = starts.flatMap((a) => ends.map((z) => [a, z] as const)).filter(([a, z], n, all) => all.findIndex(([x, y]) => x === a && y === z) === n);
  /** A candidate's verdict: whether the visible text, the other characters' look and blocks
   *  hold; then whether the typed characters have the wanted look, and which keys differ. */
  const judge = (t: string): { kept: false } | { kept: true; nm: Model; d: number; differs: (keyof RunStyle)[] } => {
    const nm = buildModel(t);
    if (nm.chars.map((c) => c.ch).join("") !== expect) return { kept: false };
    const d = nm.chars.length - (m.chars.length - (j - i));
    const at = (x: number) => (x < i ? x : x - (j - i) + d);
    for (let x = 0; x < m.chars.length; x++) {
      if (x >= i && x < j) continue;
      if (!sameLook(m, x, nm, at(x))) return { kept: false };
    }
    const kept = [...Array(m.chars.length).keys()].filter((x) => x < i || x >= j);
    for (let n = 0; n + 1 < kept.length; n++) {
      const x = kept[n];
      const y = kept[n + 1];
      if ((m.chars[x].block === m.chars[y].block) !== (nm.chars[at(x)].block === nm.chars[at(y)].block)) return { kept: false };
    }
    if (i > 0 && nm.chars[i - 1].block !== nm.chars[i].block && m.chars[i - 1].block === m.chars[i].block) return { kept: false };
    const differs = new Set<keyof RunStyle>();
    for (let x = i; x < i + d; x++) {
      const c = nm.chars[x];
      if (c.kind !== "text" || c.block !== nm.chars[i].block) return { kept: false };
      if (norm(c, ["link"]) === norm({ ...m.chars[i], ch: c.ch, kind: c.kind, style: want } as VisibleChar, ["link"])) continue;
      for (const key of Object.keys(want) as (keyof RunStyle)[]) if (key !== "link" && c.style[key] !== want[key] && !(isWs(c.ch) && (key === "bold" || key === "italic"))) differs.add(key);
    }
    return { kept: true, nm, d, differs: [...differs] };
  };
  // Candidates whose typed text has another look are kept for a second try: given the wanted
  // look property by property (as typing does), and judged again (found by the generated test
  // of finding 38: otherwise the delete-then-type fallback could change a space's look).
  const restylable: { t: string; d: number; differs: (keyof RunStyle)[] }[] = [];
  for (const [a, z] of spans) for (const enc of encodings(ins)) {
    const t = text.slice(0, a) + enc + text.slice(z);
    const j1 = judge(t);
    if (!j1.kept) continue;
    if (j1.differs.length === 0) return finishTyping(t, i, j1.d, j1.nm, pending, false);
    restylable.push({ t, d: j1.d, differs: j1.differs });
  }
  for (const c of restylable) {
    const fixes = c.differs.map((key) => fixFor(key, want)).filter((x): x is Change => x !== null);
    const r = restyle(c.t, i, c.d, fixes);
    if (!r.ok) continue;
    const j2 = judge(r.text);
    if (j2.kept && j2.differs.length === 0) return finishTyping(r.text, i, j2.d, j2.nm, pending, false);
  }
  // Typed over the start of inline code, the text may stand outside the code (typing does not
  // make code): that is closer to what was asked than deleting first, which can drop a space.
  const plain = restylable.find((c) => c.differs.every((k) => k === "code"));
  if (plain) {
    const nm = buildModel(plain.t);
    return finishTyping(plain.t, i, plain.d, nm, pending, false);
  }
  return null;
}

function finishTyping(text: string, k: number, d: number, nm: Model, pending: Change[], differs: boolean): Edit {
  let t = text;
  let model = nm;
  if (pending.length) {
    const r = restyle(t, k, d, pending);
    t = r.text;
    model = buildModel(t);
    if (!r.ok) differs = true;
  }
  return { ok: true, text: t, cursor: model.chars[k + d - 1].end, ...(differs ? { styleDiffers: true } : {}) };
}

/** In a code block typing is raw; the code block must stay one code block with this text. */
function typeInCode(m: Model, b: BlockModel, p: number, ins: string): Edit {
  const t = m.text.slice(0, p) + ins + m.text.slice(p);
  const nm = buildModel(t);
  const vis = (mm: Model) => mm.chars.map((c) => c.ch).join("");
  const k = indexAt(m, p, b);
  const want = vis(m).slice(0, k) + ins + vis(m).slice(k);
  if (vis(nm) !== want || nm.blocks.length !== m.blocks.length) return { ok: false, reason: "this would end the code block; edit it in Raw" };
  return { ok: true, text: t, cursor: p + ins.length };
}

// --- deleting -------------------------------------------------------------------------------

/**
 * Judges a deletion of the visible characters [i, j): the rest keep their style and grouping;
 * when the deletion runs from inside one block into inside another, the two join and the
 * joined characters may take the first block's look (size, block attributes).
 */
function judgeDelete(old: Model, newText: string, i: number, j: number): boolean {
  const nm = buildModel(newText);
  const d = j - i;
  const ov = old.chars;
  const spans = d > 0 && ov[i].block !== ov[j - 1].block;
  const merge = spans && i > 0 && j < ov.length && ov[i - 1].block === ov[i].block && ov[j - 1].block === ov[j].block;
  let keep = [...Array(old.chars.length).keys()].filter((x) => x < i || x >= j);
  // Spaces left at the start or end of a paragraph by the deletion do not show: they may go.
  // (Before the deletion no paragraph had a visible space at either end.)
  const sameBlock = (x: number, y: number) => (x < i && y >= j ? (spans ? merge : ov[x].block === ov[y].block) : ov[x].block === ov[y].block);
  const plainWs = (x: number) => isMdSpace(ov[x].ch) && ov[x].kind === "text";
  if (nm.chars.length !== keep.length) {
    const groups: number[][] = [];
    for (const x of keep) {
      const g = groups[groups.length - 1];
      if (g && sameBlock(g[g.length - 1], x)) g.push(x);
      else groups.push([x]);
    }
    for (const g of groups) {
      while (g.length && plainWs(g[0])) g.shift();
      while (g.length && plainWs(g[g.length - 1])) g.pop();
    }
    keep = groups.flat();
  }
  if (nm.chars.length !== keep.length) return false;
  const pos = new Map(keep.map((x, n) => [x, n]));
  const at = (x: number) => pos.get(x)!;
  const moved = new Set<number>();
  if (merge) for (let x = j; x < ov.length && ov[x].block === ov[j].block; x++) moved.add(x);
  for (const x of keep) {
    const a = ov[x];
    const b = nm.chars[at(x)];
    if (a.ch !== b.ch) return false;
    if (!sameLook(old, x, nm, at(x), moved.has(x) ? ["size", "color", "bg", "font", "underline"] : [])) return false;
  }
  for (let n = 0; n + 1 < keep.length; n++) {
    const x = keep[n];
    const y = keep[n + 1];
    const was = ov[x].block === ov[y].block;
    const want = x < i && y >= j ? (spans ? merge : was) : was;
    if (want !== (nm.chars[at(x)].block === nm.chars[at(y)].block)) return false;
  }
  return true;
}

/** Deletes the visible characters [i, j) of a text. */
export function deleteVisible(text: string, i: number, j: number): Edit {
  const m = buildModel(text);
  if (j <= i) return { ok: true, text, cursor: i < m.chars.length ? m.chars[i].start : text.length };
  const cs = m.chars;
  const lo = i > 0 ? cs[i - 1].end : contentStart(m);
  const hi = j < cs.length ? cs[j].start : text.length;
  const starts = places(m, lo, cs[i].start, cs[i].start);
  const ends = places(m, cs[j - 1].end, hi, cs[j - 1].end);
  // Whole blocks: their lines go, with the blank line after them.
  const bi = m.blocks[cs[i].block];
  const bj = m.blocks[cs[j - 1].block];
  if (bi && i === bi.va) starts.push(region(text, bi)[0]);
  if (bj && j === bj.vb) {
    const next = m.blocks.find((b) => b.index > bj.index && b.vb > b.va && region(text, b)[0] >= attrEnd(bj));
    ends.push(next ? region(text, next)[0] : text.length);
  }
  // First, each character's own source, and every element left empty as a whole.
  if (!(bi && bj && bi.index !== bj.index)) {
    const cuts: [number, number][] = [];
    const whole = (n: INode) => n.kind !== "text" && n.va >= i && n.vb <= j && n.vb > n.va;
    const covered = new Set<number>();
    const visit = (ns: INode[]) => {
      for (const n of ns) {
        if (whole(n)) {
          cuts.push([n.start, n.end]);
          for (let x = n.va; x < n.vb; x++) covered.add(x);
        } else visit(n.children);
      }
    };
    for (const b of m.blocks) if (b.vb > i && b.va < j) visit(b.root);
    for (let x = i; x < j; x++) if (!covered.has(x)) cuts.push([cs[x].start, cs[x].end]);
    cuts.sort((x, y) => y[0] - x[0]);
    let t = text;
    let last = Infinity;
    for (const [x, y] of cuts) {
      if (y > last) continue;
      t = t.slice(0, x) + t.slice(y);
      last = x;
    }
    if (judgeDelete(m, t, i, j)) return { ok: true, text: t, cursor: Math.min(cuts[cuts.length - 1][0], t.length) };
  }
  const pairs: [number, number][] = [];
  for (const s of new Set(starts)) for (const e of new Set(ends)) if (e > s) pairs.push([s, e]);
  pairs.sort((a, b) => a[1] - a[0] - (b[1] - b[0]));
  for (const [s, e] of pairs) {
    let t = text.slice(0, s) + text.slice(e);
    // Deleting whole blocks at the end of the note leaves no blank lines behind.
    if (e === text.length) t = t.replace(/(\r?\n)+$/, (x) => (s > 0 ? x.slice(0, x.startsWith("\r") ? 2 : 1) : ""));
    if (judgeDelete(m, t, i, j)) return { ok: true, text: t, cursor: Math.min(s, t.length) };
  }
  return { ok: false, reason: "this cannot be deleted without changing other text; delete it in Raw" };
}

/** Deletes a selection: the visible characters wholly inside it. */
export function deleteRange(text: string, from: number, to: number): Edit {
  const m = buildModel(text);
  const inside = m.chars.map((c, n) => (c.start >= from && c.end <= to ? n : -1)).filter((n) => n >= 0);
  if (inside.length === 0) {
    // Only blank lines: delete them if that changes nothing visible.
    const t = text.slice(0, from) + text.slice(to);
    const nm = buildModel(t);
    if (nm.chars.length === m.chars.length && nm.chars.every((c, n) => norm(c) === norm(m.chars[n]) && c.ch === m.chars[n].ch && c.block === m.chars[n].block)) return { ok: true, text: t, cursor: from };
    return { ok: true, text, cursor: from };
  }
  return deleteVisible(text, inside[0], inside[inside.length - 1] + 1);
}

/** The visible index range of the word before or after k (for Ctrl+Backspace, Ctrl+Delete). */
function wordRange(m: Model, k: number, dir: -1 | 1): [number, number] {
  const cs = m.chars;
  const word = (n: number) => n >= 0 && n < cs.length && !isWs(cs[n].ch) && cs[n].kind === "text";
  if (dir < 0) {
    let a = k;
    while (a > 0 && !word(a - 1) && cs[a - 1].block === cs[k - 1].block) a--;
    while (a > 0 && word(a - 1)) a--;
    return [a, k];
  }
  let b = k;
  while (b < cs.length && !word(b) && cs[b].block === cs[k].block) b++;
  while (b < cs.length && word(b)) b++;
  return [k, b];
}

/** Backspace (dir -1) or Delete (dir 1) at a collapsed cursor; `word` deletes a word. */
export function deleteAt(text: string, p: number, dir: -1 | 1, word = false): Edit {
  const m = buildModel(text);
  const b = blockAt(m, p);
  if (b && b.info.kind === "code") {
    // Raw in a code block, one character, if the code block stays.
    const k = indexAt(m, p, b);
    if (dir < 0 ? k > b.va : k < b.vb - 1) {
      const n = dir < 0 ? k - 1 : k;
      const c = m.chars[n];
      const t = text.slice(0, c.start) + text.slice(c.end);
      const nm = buildModel(t);
      if (nm.chars.length === m.chars.length - 1 && nm.blocks.length === m.blocks.length) return { ok: true, text: t, cursor: c.start };
    }
    return { ok: false, reason: "this would end the code block; edit it in Raw" };
  }
  if (!b) return deleteBetween(m, p, dir);
  const k = indexAt(m, p, b);
  if (dir < 0 && k === b.va) return backspaceAtStart(m, b);
  if (dir > 0 && k === b.vb) {
    const next = m.blocks.find((x) => x.index > b.index && x.info.kind !== "cell");
    if (!next) return { ok: true, text, cursor: p };
    if (next.vb === next.va) return deleteBetween(m, attrEnd(b) + 1, 1);
    return joinBlocks(m, b, next);
  }
  if (word) {
    const [a, z] = wordRange(m, k, dir);
    return deleteVisible(text, Math.max(a, b.va), Math.min(z, b.vb));
  }
  // One character (a pair of surrogates counts as one).
  return dir < 0 ? deleteVisible(text, k - 1, k) : deleteVisible(text, k, k + 1);
}

/** Backspace or Delete on a line between blocks: removes a blank line or an empty marker. */
function deleteBetween(m: Model, p: number, dir: -1 | 1): Edit {
  const text = m.text;
  const ls = lineStartOf(text, p);
  const le = lineEndOf(text, p);
  const line = text.slice(ls, le);
  // An empty list item, quote line or heading: its markup goes, the line stays.
  if (!isBlank(line) && ls < le) {
    const t = text.slice(0, ls) + text.slice(le);
    if (visibleSame(m, t)) return { ok: true, text: t, cursor: ls };
  }
  const tries: [number, number, number][] = dir < 0 ? [[ls - 1, ls, ls - 1], [ls, Math.min(le + 1, text.length), ls]] : [[le, le + 1, ls], [ls - 1, ls, ls - 1]];
  for (const [a, z, cur] of tries) {
    if (a < contentStart(m) || z > text.length || a >= z) continue;
    const t = text.slice(0, a) + text.slice(z);
    if (visibleSame(m, t)) {
      return { ok: true, text: t, cursor: Math.max(0, Math.min(cur, t.length)) };
    }
  }
  // The blank line keeps two blocks apart: join them.
  const before = [...m.blocks].reverse().find((x) => region(text, x)[1] < p && x.info.kind !== "cell");
  const after = m.blocks.find((x) => region(text, x)[0] > p && x.info.kind !== "cell");
  if (dir < 0 && before) return { ok: true, text, cursor: before.vb > before.va ? m.chars[before.vb - 1].end : region(text, before)[1] };
  if (dir > 0 && after) return { ok: true, text, cursor: after.vb > after.va ? m.chars[after.va].start : region(text, after)[0] };
  return { ok: true, text, cursor: p };
}

function visibleSame(m: Model, t: string): boolean {
  const nm = buildModel(t);
  return nm.chars.length === m.chars.length && nm.chars.every((c, n) => c.ch === m.chars[n].ch && norm(c) === norm(m.chars[n]) && (n === 0 || (c.block === nm.chars[n - 1].block) === (m.chars[n].block === m.chars[n - 1].block)));
}

/** Backspace at the start of a block: a heading, quote or list item becomes normal text; a
 * paragraph joins the one before it (EDITOR-PLAN 3.2). */
function backspaceAtStart(m: Model, b: BlockModel): Edit {
  const text = m.text;
  const p = b.vb > b.va ? m.chars[b.va].start : b.info.range.start;
  const list = /\/list:(bullet|ordered)\/item:\d+(:task(-done)?)?$/.exec(b.info.path);
  if (list) {
    const kind: ListKind = list[2] ? "task" : list[1] === "ordered" ? "ordered" : "bullet";
    const r = toggleList(text, p, p, kind);
    if (r.ok) return { ok: true, text: r.text, cursor: r.from };
    return r;
  }
  if (b.info.kind === "heading" || b.info.path.includes("/quote")) {
    const r = setBlockStyle(text, p, p, "paragraph");
    if (r.ok) return { ok: true, text: r.text, cursor: r.from };
    return r;
  }
  const prev = [...m.blocks].reverse().find((x) => x.index < b.index && x.info.kind !== "cell");
  if (!prev) {
    // The first block: a blank line shown above it goes (the hidden one after the front matter
    // stays).
    const ls = region(text, b)[0];
    const none = !m.blocks.some((x) => x.index < b.index);
    if (none && ls - 1 >= contentStart(m) && text[ls - 1] === "\n" && isBlank(text.slice(contentStart(m), ls))) {
      const t = text.slice(0, ls - 1) + text.slice(ls);
      if (visibleSame(m, t)) return { ok: true, text: t, cursor: p - 1 };
    }
    return { ok: true, text, cursor: p };
  }
  if (prev.info.kind === "rule") {
    // The line above goes.
    const [a, z] = region(text, prev);
    let e = z;
    while (e < text.length && (text[e] === "\n" || text[e] === "\r") && e < region(text, b)[0]) e++;
    const t = text.slice(0, a) + text.slice(e);
    if (visibleSame(m, t)) return { ok: true, text: t, cursor: p - (e - a) };
    return { ok: false, reason: "the line above cannot be removed here; edit it in Raw" };
  }
  return joinBlocks(m, prev, b);
}

/** Joins block `b` onto the end of block `a`; `b`'s text takes `a`'s look. */
function joinBlocks(m: Model, a: BlockModel, b: BlockModel): Edit {
  const text = m.text;
  if (a.info.kind === "code" || b.info.kind === "code") return { ok: false, reason: "a code block cannot be joined to text; edit it in Raw" };
  if (a.info.kind === "cell" || b.info.kind === "cell" || a.info.kind === "rule" || b.info.kind === "rule") return { ok: false, reason: "this cannot be joined; edit it in Raw" };
  if (b.vb === b.va) {
    const t = text.slice(0, attrEnd(a)) + text.slice(region(text, b)[1]);
    return { ok: true, text: t, cursor: a.vb > a.va ? m.chars[a.vb - 1].end : a.info.range.end };
  }
  const end = a.vb > a.va ? m.chars[a.vb - 1].end : a.info.range.end;
  const firsts = [m.chars[b.va].start, ...places(m, region(text, b)[0], m.chars[b.va].start, m.chars[b.va].start)];
  const lasts = [a.info.range.end, end, attrEnd(a)];
  for (const z of new Set(firsts)) {
    for (const s of new Set(lasts)) {
      if (z <= s) continue;
      const t = text.slice(0, s) + text.slice(z);
      const nm = buildModel(t);
      if (nm.chars.length !== m.chars.length) continue;
      let ok = nm.chars.every((c, n) => c.ch === m.chars[n].ch);
      for (let n = 0; ok && n < m.chars.length; n++) {
        const moved = n >= b.va && n < b.vb;
        const drop: (keyof RunStyle)[] = moved ? ["size", "color", "bg", "font", "underline"] : [];
        if (norm(nm.chars[n], drop) !== norm(m.chars[n], drop)) ok = false;
        if (n > 0) {
          const was = m.chars[n].block === m.chars[n - 1].block || (n === b.va && a.vb === b.va && a.vb > a.va);
          if (was !== (nm.chars[n].block === nm.chars[n - 1].block)) ok = false;
        }
      }
      if (ok) return { ok: true, text: t, cursor: nm.chars[b.va].start };
    }
  }
  return { ok: false, reason: "these paragraphs cannot be joined without changing other text; join them in Raw" };
}

// --- Enter ----------------------------------------------------------------------------------

/** The text that starts a continuation line inside the block's containers (quotes, items). */
function containerPrefix(text: string, b: BlockModel): { prefix: string; marker: string | null; heading: number } {
  const ls = lineStartOf(text, b.info.range.start);
  let rest = text.slice(ls, lineEndOf(text, ls));
  let prefix = "";
  let marker: string | null = null;
  let heading = 0;
  for (;;) {
    const q = /^ {0,3}> ?/.exec(rest);
    if (q) {
      prefix += q[0].endsWith(" ") ? q[0] : q[0] + " ";
      rest = rest.slice(q[0].length);
      continue;
    }
    const li = /^( {0,3})([-+*]|(\d{1,9})([.)]))( +|$)(\[[ xX]\] )?/.exec(rest);
    if (li && b.info.path.includes("/list:")) {
      const num = li[3] ? `${Number(li[3]) + 1}${li[4]}` : li[2];
      marker = prefix + li[1] + num + " " + (li[6] ? "[ ] " : "");
      prefix += " ".repeat(li[0].length - (li[6]?.length ?? 0));
      rest = rest.slice(li[0].length);
      continue;
    }
    const h = /^ {0,3}(#{1,6})[ \t]+/.exec(rest);
    if (h && b.info.kind === "heading") heading = h[1].length;
    // A later paragraph of a list item: its indentation.
    const sp = /^ +/.exec(rest);
    if (sp && b.info.path.includes("/list:") && !marker) prefix += sp[0];
    break;
  }
  return { prefix, marker, heading };
}

/** Enter: a new paragraph, list item or empty line (EDITOR-PLAN 3.2). */
export function enter(text: string, from: number, to: number): Edit {
  if (from !== to) {
    const d = deleteRange(text, from, to);
    if (!d.ok) return d;
    text = d.text;
    from = to = d.cursor;
  }
  const m = buildModel(text);
  const p = from;
  const b = blockAt(m, p);
  if (!b) {
    const ls = lineStartOf(text, p);
    const line = text.slice(ls, lineEndOf(text, ls));
    // An empty list item or quote line: Enter ends the list or quote.
    if (!isBlank(line)) {
      const t = text.slice(0, ls) + text.slice(ls + line.length);
      if (visibleSame(m, t)) return { ok: true, text: t, cursor: ls };
    }
    const t = text.slice(0, p) + "\n" + text.slice(p);
    return visibleSame(m, t) ? { ok: true, text: t, cursor: p + 1 } : { ok: false, reason: "a new line cannot go here" };
  }
  if (b.info.kind === "code") {
    // Enter on the code's empty last line (so, a second Enter) leaves the block: that line goes
    // and the cursor is on a new line under the block.
    const ls = lineStartOf(text, p);
    const le = lineEndOf(text, ls);
    if (isBlank(text.slice(ls, le)) && /^ {0,3}(`{3,}|~{3,})[ \t]*$/.test(text.slice(le + 1, lineEndOf(text, le + 1)))) {
      const out = leaveCode(text, p);
      // Only when the empty line was taken out: a block with nothing else in it stays as it is.
      if (out && out.text.slice(ls, ls + 3) === text.slice(le + 1, le + 4)) return { ok: true, text: out.text, cursor: out.cursor };
    }
    return typeInCodeNewline(m, b, p);
  }
  if (b.info.kind === "cell") return { ok: false, reason: "a table cell holds one line; edit the table as text" };
  {
    // A task with its box and no text: Enter ends the list, as it does for the other lists.
    const ls = lineStartOf(text, p);
    const line = text.slice(ls, lineEndOf(text, ls));
    if (/^[ \t]*[-*+] \[[ xX]\] ?$/.test(line)) return { ok: true, text: text.slice(0, ls) + text.slice(ls + line.length), cursor: ls };
  }
  const { prefix, marker, heading } = containerPrefix(text, b);
  const k = indexAt(m, p, b);
  const blank = prefix.replace(/\s+$/, "");
  if (k === b.vb) {
    // At the end: an empty item, an empty quote line, or an empty line after the block.
    const at = attrEnd(b);
    // On an empty line, typing makes a block of its own (typeText adds blank lines as needed).
    const tries = marker ? ["\n" + marker] : prefix.includes(">") ? ["\n" + blank + "\n" + prefix] : ["\n\n"];
    for (const ins of tries) {
      const t = text.slice(0, at) + ins + text.slice(at);
      if (visibleSame(m, t)) return { ok: true, text: t, cursor: at + ins.length };
    }
    return { ok: false, reason: "a new line cannot go here; edit it in Raw" };
  }
  if (k === b.va) {
    // At the start: an empty line (or item) above; the cursor stays with the text.
    const ls = lineStartOf(text, b.info.range.start);
    const ins = marker ? marker.replace(/ $/, "") + "\n" : prefix.includes(">") ? prefix + "\n" + blank + "\n" : "\n";
    const t = text.slice(0, ls) + ins + text.slice(ls);
    if (visibleSame(m, t)) return { ok: true, text: t, cursor: p + ins.length };
    return { ok: false, reason: "a new line cannot go here; edit it in Raw" };
  }
  return splitBlock(m, b, k, p, { prefix, marker, heading, blank });
}

function typeInCodeNewline(m: Model, b: BlockModel, p: number): Edit {
  return typeInCode(m, b, p, "\n");
}

/** Splits a block in two at visible index k, closing and reopening the inline markup there. */
function splitBlock(m: Model, b: BlockModel, k: number, p: number, c: { prefix: string; marker: string | null; heading: number; blank: string }): Edit {
  const text = m.text;
  const spanning = [...allNodes(b.root)].filter((n) => n.kind !== "text" && n.va < k && n.vb > k && n.contentStart < n.contentEnd);
  // Innermost first for closing.
  spanning.sort((x, y) => x.end - x.start - (y.end - y.start));
  const pb = b.block as { attributes?: { range: { start: number; end: number } } } | null;
  const attrLine = pb && "attributes" in pb && pb.attributes && b.info.kind !== "cell" ? text.slice(pb.attributes.range.start, pb.attributes.range.end) : "";
  const lead = c.marker ?? (c.heading ? c.prefix + "#".repeat(c.heading) + " " : c.prefix);
  const sep = c.marker ? "\n" : "\n" + c.blank + "\n";
  // Spaces at the cut would end a paragraph or begin one: they are dropped.
  let a = k;
  while (a > b.va && isMdSpace(m.chars[a - 1].ch) && m.chars[a - 1].kind === "text") a--;
  let z = k;
  while (z < b.vb && isMdSpace(m.chars[z].ch) && m.chars[z].kind === "text") z++;
  if (a === b.va || z === b.vb) return a === b.va ? enter(text, m.chars[b.va].start, m.chars[b.va].start) : enter(text, b.info.range.end, b.info.range.end);
  const lo = m.chars[a - 1].end;
  const hi = m.chars[z].start;
  const cands = [...new Set([p, lo, hi, ...places(m, lo, hi, p)])].filter((x) => x >= lo && x <= hi);
  for (const q of cands) {
    const inner = spanning.filter((n) => n.contentStart <= q && q <= n.contentEnd);
    if (inner.length !== spanning.length) continue;
    const closes = inner.map((n) => text.slice(n.contentEnd, n.end)).join("");
    const opens = [...inner].reverse().map((n) => text.slice(n.start, n.contentStart)).join("");
    const mid = closes + (attrLine ? "\n" + c.prefix + attrLine : "") + sep + lead + opens;
    // The spaces next to the cut go: their own source, nothing else.
    const cuts: [number, number, string][] = [];
    for (let n = a; n < z; n++) cuts.push([m.chars[n].start, m.chars[n].end, ""]);
    cuts.push([q, q, mid]);
    cuts.sort((x, y) => y[0] - x[0] || (x[1] === x[0] ? -1 : 1));
    let t = text;
    for (const [x, y, w] of cuts) t = t.slice(0, x) + w + t.slice(y);
    const nm = buildModel(t);
    const want = m.chars.filter((_, n) => !(n >= a && n < z));
    if (nm.chars.length !== want.length) continue;
    let ok = true;
    for (let n = 0; ok && n < want.length; n++) {
      if (nm.chars[n].ch !== want[n].ch || !sameLook(m, m.chars.indexOf(want[n]), nm, n)) ok = false;
    }
    // Exactly one new block boundary, at the cut.
    for (let n = 1; ok && n < want.length; n++) {
      const oi = m.chars.indexOf(want[n]);
      const op = m.chars.indexOf(want[n - 1]);
      const was = m.chars[oi].block === m.chars[op].block;
      const expect = n === a ? false : was;
      if (expect !== (nm.chars[n].block === nm.chars[n - 1].block)) ok = false;
    }
    if (ok) return { ok: true, text: t, cursor: nm.chars[a].start };
  }
  return { ok: false, reason: "this paragraph cannot be split here; edit it in Raw" };
}

/** Shift+Enter: a line break inside the paragraph (a hard break in the raw text). */
export function lineBreak(text: string, from: number, to: number): Edit {
  if (from !== to) {
    const d = deleteRange(text, from, to);
    if (!d.ok) return d;
    text = d.text;
    from = to = d.cursor;
  }
  const m = buildModel(text);
  const b = blockAt(m, from);
  if (!b || b.vb === b.va) return enter(text, from, to);
  if (b.info.kind === "code") return typeInCode(m, b, from, "\n");
  if (b.info.kind !== "paragraph") return { ok: false, reason: "a line break goes in a paragraph" };
  const k = indexAt(m, from, b);
  if (k === b.va || k === b.vb) return { ok: false, reason: "a line break goes between words of a paragraph" };
  const { prefix } = containerPrefix(text, b);
  const cont = prefix;
  // Spaces next to a line break do not show: they go.
  let a = k;
  while (a > b.va && isMdSpace(m.chars[a - 1].ch) && m.chars[a - 1].kind === "text") a--;
  let z = k;
  while (z < b.vb && isMdSpace(m.chars[z].ch) && m.chars[z].kind === "text") z++;
  if (a === b.va || z === b.vb) return { ok: false, reason: "a line break goes between words of a paragraph" };
  const lo = m.chars[a - 1].end;
  const hi = m.chars[z].start;
  const want = [...m.chars.slice(0, a), null, ...m.chars.slice(z)];
  for (const q of places(m, lo, hi, from)) {
    const cuts: [number, number, string][] = [];
    for (let n = a; n < z; n++) cuts.push([m.chars[n].start, m.chars[n].end, ""]);
    cuts.push([q, q, "\\\n" + cont]);
    cuts.sort((x, y) => y[0] - x[0] || (x[1] === x[0] ? -1 : 1));
    let t = text;
    for (const [x, y, w] of cuts) t = t.slice(0, x) + w + t.slice(y);
    const nm = buildModel(t);
    if (nm.chars.length !== want.length || nm.chars[a].kind !== "hard") continue;
    const ok = want.every((c, n) => {
      if (c === null) return true;
      const x = nm.chars[n];
      return x.ch === c.ch && sameLook(m, m.chars.indexOf(c), nm, n) && (x.block === nm.chars[a].block) === (c.block === b.index);
    });
    if (ok) return { ok: true, text: t, cursor: nm.chars[a + 1]?.start ?? t.length };
  }
  return { ok: false, reason: "a line break cannot go here; edit it in Raw" };
}

// --- line-start shortcuts -------------------------------------------------------------------

/**
 * After a character is typed at `p`: if the paragraph's text so far is `- `, `* `, `1. ` or
 * `[] `, the shortcut's list (EDITOR-PLAN 3.2). `# `, `> ` and three backticks are text: Nook
 * makes no heading, quote or code block (SPEC-PLAIN).
 */
export function lineShortcut(text: string, p: number): Edit | null {
  const m = buildModel(text);
  const b = blockAt(m, p);
  if (!b || b.info.kind !== "paragraph" || b.info.path !== "" || b.vb === b.va) return null;
  const k = indexAt(m, p, b);
  const tail = k === b.vb ? /[ \t]*$/.exec(text.slice(m.chars[k - 1].end, p))![0] : "";
  const typed = m.chars.slice(b.va, k).map((c) => c.ch).join("") + tail;
  const list: Record<string, ListKind> = { "- ": "bullet", "* ": "bullet", "1. ": "ordered", "[] ": "task" };
  if (!list[typed]) return null;
  if (k === b.vb || (tail && k === b.vb)) {
    // Nothing after the shortcut yet: write the empty item's markup.
    const [a, z] = region(text, b);
    const markup = list[typed] === "task" ? "- [ ] " : list[typed] === "ordered" ? "1. " : "- ";
    const t = text.slice(0, a) + markup + text.slice(z);
    return { ok: true, text: t, cursor: a + markup.length };
  }
  const r = deleteVisible(text, b.va, b.va + typed.length);
  if (!r.ok) return null;
  const out = toggleList(r.text, r.cursor, r.cursor, list[typed]);
  if (!out.ok) return null;
  return { ok: true, text: out.text, cursor: out.from };
}

// --- copy and paste -------------------------------------------------------------------------

/** What a copy puts on the clipboard: the visible text, and the Markdown of the selection. */
export function copySelection(text: string, from: number, to: number): { plain: string; markdown: string | null } {
  const m = buildModel(text);
  const sel = m.chars.map((c, n) => (c.start >= from && c.end <= to ? n : -1)).filter((n) => n >= 0);
  if (sel.length === 0) return { plain: "", markdown: null };
  const i = sel[0];
  const j = sel[sel.length - 1] + 1;
  let plain = "";
  for (let n = i; n < j; n++) {
    const c = m.chars[n];
    if (n > i && c.block !== m.chars[n - 1].block) plain += "\n";
    plain += c.kind === "hard" ? "\n" : c.kind === "image" ? (c.image?.alt ?? "") : plainSpaces(c.ch);
  }
  // The Markdown: the touched blocks with the characters outside the selection deleted.
  const first = m.blocks[m.chars[i].block];
  const last = m.blocks[m.chars[j - 1].block];
  let t = text;
  const tail = deleteVisible(t, j, last.vb);
  if (!tail.ok) return { plain, markdown: null };
  t = tail.text;
  const head = deleteVisible(t, first.va, i);
  if (!head.ok) return { plain, markdown: null };
  t = head.text;
  const tm = buildModel(t);
  const a = tm.blocks[m.chars[i].block];
  const z = tm.blocks[m.chars[j - 1].block];
  if (!a || !z) return { plain, markdown: null };
  const md = t.slice(region(t, a)[0], region(t, z)[1]);
  // Reference links need their definitions: such a copy is plain text only.
  const fm = buildModel(md);
  const want = m.chars.slice(i, j);
  if (fm.chars.length !== want.length || fm.chars.some((c, n) => c.ch !== want[n].ch || c.style.link !== want[n].style.link)) return { plain, markdown: null };
  return { plain, markdown: md };
}

/** Pastes text from elsewhere: literal, one paragraph per line (EDITOR-PLAN 3.2). */
export function pastePlain(text: string, from: number, to: number, plain: string): Edit {
  const lines = plain
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    .replace(/[\u0000-\u0008\u000b-\u001f]/g, "")
    .split("\n");
  // One line is typed as it is; of several, blank lines (empty paragraphs) are left out.
  if (lines.length > 1) for (let n = lines.length - 1; n >= 0; n--) if (isBlank(lines[n])) lines.splice(n, 1);
  let t = text;
  let a = from;
  let z = to;
  if (a !== z) {
    const d = deleteRange(t, a, z);
    if (!d.ok) return d;
    t = d.text;
    a = z = d.cursor;
  }
  for (let n = 0; n < lines.length; n++) {
    if (n > 0) {
      const e = enter(t, a, z);
      if (!e.ok) return e;
      t = e.text;
      a = z = e.cursor;
    }
    const r = typeText(t, a, z, n === 0 ? lines[n] : lines[n].replace(/^[ \t]+/, ""));
    if (!r.ok) return r;
    t = r.text;
    a = z = r.cursor;
  }
  return { ok: true, text: t, cursor: a };
}

/** Pastes Markdown copied in this app: the formatting is kept when it can be. */
export function pasteMarkdown(text: string, from: number, to: number, md: string, plain: string): Edit {
  if (from !== to) {
    const d = deleteRange(text, from, to);
    if (!d.ok) return d;
    text = d.text;
    from = to = d.cursor;
  }
  const fm = buildModel(md);
  // Markdown that holds a heading, a quote or a code block is pasted as plain lines: Nook makes
  // none of the three (SPEC-PLAIN 5.1).
  if (fm.blocks.some((x) => x.info.kind === "heading" || x.info.kind === "code" || x.info.path.includes("/quote"))) return pastePlain(text, from, to, plain);
  const m = buildModel(text);
  const b = blockAt(m, from);
  const inline = fm.blocks.length === 1 && fm.blocks[0].info.kind === "paragraph" && fm.blocks[0].info.path === "";
  if (inline && b && b.info.kind !== "code") {
    // One paragraph: its inline Markdown goes in at the cursor, if the check passes.
    let k = indexAt(m, from, b);
    let src = md.slice(fm.blocks[0].info.range.start, fm.blocks[0].info.range.end);
    let base = text;
    let at = from;
    let ws = "";
    // Spaces typed at the end of the paragraph come in before the pasted text.
    if (b.vb > b.va && k === b.vb) {
      ws = /[ \t]*$/.exec(text.slice(m.chars[k - 1].end, from))![0];
      base = text.slice(0, from - ws.length) + text.slice(from);
      at = from - ws.length;
      src = ws + src;
    }
    const bm = buildModel(base);
    k = indexAt(bm, at, blockAt(bm, at));
    const lo = b.vb > b.va && k > b.va ? bm.chars[k - 1].end : at;
    const hi = k < b.vb ? bm.chars[k].start : at;
    for (const q of places(bm, lo, hi, at)) {
      const t = base.slice(0, q) + src + base.slice(q);
      const nm = buildModel(t);
      const d = fm.chars.length + ws.length;
      if (nm.chars.length !== bm.chars.length + d) continue;
      if (nm.chars.slice(k, k + ws.length).some((c) => !isWs(c.ch))) continue;
      const ok =
        bm.chars.every((c, n) => norm(c) === norm(nm.chars[n < k ? n : n + d]) && c.ch === nm.chars[n < k ? n : n + d].ch) &&
        fm.chars.every((c, n) => {
          const x = nm.chars[k + ws.length + n];
          return x.ch === c.ch && ["bold", "italic", "strike", "underline", "code", "link", "color", "bg", "font"].every((key) => (key === "bold" || key === "italic") && isWs(c.ch) ? true : x.style[key as keyof RunStyle] === c.style[key as keyof RunStyle]);
        });
      if (ok) return { ok: true, text: t, cursor: nm.chars[k + d - 1].end };
      void m;
    }
  } else if (!b) {
    // Between blocks: the blocks go in as they are, apart from their neighbours.
    for (const [x, y] of [["", ""], ["\n", ""], ["", "\n"], ["\n", "\n"], ["\n\n", "\n\n"]]) {
      const t = text.slice(0, from) + x + md + y + text.slice(from);
      const nm = buildModel(t);
      if (nm.chars.length === m.chars.length + fm.chars.length) {
        const k = indexAt(m, from, null);
        const ok = m.chars.every((c, n) => norm(c) === norm(nm.chars[n < k ? n : n + fm.chars.length]));
        if (ok) return { ok: true, text: t, cursor: from + x.length + md.length };
      }
    }
  }
  return pastePlain(text, from, to, plain);
}

export type { INode };

/** Inserts Markdown blocks (a photo, say) as blocks of their own after the block at `at`. */
export function insertBlocks(text: string, at: number, md: string): Edit {
  const m = buildModel(text);
  const b = blockAt(m, at);
  const pos = b ? region(text, b)[1] : at;
  const before = text.slice(0, pos);
  const after = text.slice(pos);
  const lead = before === "" || /\n\n$/.test(before) ? "" : /\n$/.test(before) ? "\n" : "\n\n";
  const tail = after === "" || /^\n\n/.test(after) ? "" : /^\n/.test(after) ? "\n" : "\n\n";
  const t = before + lead + md + tail + after;
  const nm = buildModel(t);
  const added = buildModel(md).chars.length;
  if (nm.chars.length !== m.chars.length + added) return { ok: false, reason: "this cannot be inserted here" };
  return { ok: true, text: t, cursor: pos + lead.length + md.length };
}

/** The note with an empty line under the code block the cursor is in, and the cursor on it. */
export function leaveCode(text: string, cursor: number): { text: string; cursor: number } | null {
  const fence = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
  const lineStart = text.lastIndexOf("\n", cursor - 1) + 1;
  let lineEnd = text.indexOf("\n", cursor);
  if (lineEnd < 0) lineEnd = text.length;
  // The closing fence: the last line of the code block the cursor is in, as the parser reads it.
  // (Version 1 took the first fence-like line under the cursor, which in a block opened with
  // four backticks can be a line of three that belongs to the code: version 2 code review, 17.)
  const block = buildModel(text).blocks.find((b) => b.info.kind === "code" && b.info.range.start <= cursor && cursor <= b.info.range.end);
  if (!block) return null;
  const end = block.info.range.end;
  const lastLine = text.lastIndexOf("\n", end - 1) + 1;
  const close: [number, number] | null = lastLine > lineEnd && fence.test(text.slice(lastLine, end)) ? [lastLine, end] : null;
  if (!close) return null;
  let head = text.slice(0, close[1]);
  // An empty last line of the code, where the cursor is, goes: it was only a way out.
  const before = text.slice(text.lastIndexOf("\n", lineStart - 2) + 1, Math.max(lineStart - 1, 0));
  if (isBlank(text.slice(lineStart, lineEnd)) && close[0] === lineEnd + 1 && lineStart > 0 && !fence.test(before) && !/^ {0,3}(`{3,}|~{3,})/.test(before)) {
    head = text.slice(0, lineStart - 1) + text.slice(lineEnd, close[1]);
  }
  const rest = text.slice(close[1]).replace(/^\n+/, "");
  return { text: head + "\n\n" + (rest ? "\n\n" + rest : ""), cursor: head.length + 2 };
}
