// EDITOR-PLAN 5.4, block commands: block style (normal text, headings 1 to 4, quote, code
// block), lists (bulleted, numbered, task), and inserted blocks (table, horizontal line). Each
// is an edit to the block's markers, checked for unchanged visible characters and inline
// styles, and for text outside the touched blocks unchanged.

import { styleKey, type RunStyle } from "../../../../noteformat/src/index.ts";
import { buildModel, type BlockModel, type Model } from "./model.ts";
import { escapeText, Patch } from "./edits.ts";
import { isBlank } from "./blank.ts";

export type BlockTarget = "paragraph" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "quote" | "code";
export type ListKind = "bullet" | "ordered" | "task";

export type BlockResult = { ok: true; text: string; from: number; to: number } | { ok: false; reason: string };

/** The blocks a selection touches; a collapsed selection touches the block it is in. */
export function touchedBlocks(m: Model, from: number, to: number): BlockModel[] {
  const out: BlockModel[] = [];
  for (const b of m.blocks) {
    const r = b.info.range;
    const end = Math.max(r.end, attrEnd(b));
    if (from === to ? from >= r.start && from <= end : r.start < to && end > from) out.push(b);
  }
  return out;
}

function attrEnd(b: BlockModel): number {
  const pb = b.block as { attributes?: { range: { end: number } } } | null;
  return pb && "attributes" in pb && pb.attributes ? pb.attributes.range.end : b.info.range.end;
}

/** A block's own source without its attribute line (`{color=red}` as its last line): a
 *  paragraph's range holds that line, and it is not one of the paragraph's lines of text. */
function bodyOf(text: string, b: BlockModel): string {
  const r = b.info.range;
  const pb = b.block as { attributes?: { range: { start: number; end: number } } } | null;
  const a = pb && "attributes" in pb && pb.attributes ? pb.attributes.range : null;
  if (!a || a.start <= r.start || a.start > r.end) return text.slice(r.start, r.end);
  return text.slice(r.start, a.start).replace(/(\r\n|\r|\n)[ \t]*$/, "");
}

/** What the person sees of a block: its characters, breaks as line breaks. */
function blockStyleOf(b: BlockModel): string {
  if (b.info.kind === "heading") return `h${b.info.level}`;
  if (b.info.kind === "code") return "code";
  if (b.info.path.includes("/quote")) return "quote";
  return "paragraph";
}

/** The block style of the block a selection starts in, for the toolbar. */
export function blockStyleAt(text: string, from: number, to: number): string | null {
  const m = buildModel(text);
  const bs = touchedBlocks(m, from, to);
  if (bs.length === 0) return null;
  const kinds = new Set(bs.map(blockStyleOf));
  return kinds.size === 1 ? [...kinds][0] : null;
}

/** The list kind of the touched blocks, for the toolbar. */
export function listKindAt(text: string, from: number, to: number): ListKind | null {
  const m = buildModel(text);
  const bs = touchedBlocks(m, from, to);
  if (bs.length === 0) return null;
  const kinds = new Set(bs.map((b) => listKindOf(b)));
  return kinds.size === 1 ? ([...kinds][0] ?? null) : null;
}

function listKindOf(b: BlockModel): ListKind | null {
  const m = /\/list:(bullet|ordered)\/item:\d+(:task(-done)?)?$/.exec(b.info.path);
  if (!m) return null;
  if (m[2]) return "task";
  return m[1] === "ordered" ? "ordered" : "bullet";
}

/** The source lines [start, end) of a block, its attribute line included. */
function lineStarts(text: string, start: number, end: number): number[] {
  let s = start;
  while (s > 0 && text[s - 1] !== "\n" && text[s - 1] !== "\r") s--;
  const out = [s];
  for (let i = s; i < end; i++) {
    if (text[i] === "\n" || (text[i] === "\r" && text[i + 1] !== "\n")) {
      if (i + 1 < end) out.push(i + 1);
    }
  }
  return out;
}

/** The check of block commands: same visible characters and inline styles, local edit. */
function checkBlocks(old: Model, newText: string, touched: BlockModel[], ignore: (keyof RunStyle)[]): string | null {
  if (newText === old.text) return "nothing changed";
  const nm = buildModel(newText);
  // Breaks of any kind count as line breaks; the line ending a code block's last line is not
  // a character the person sees.
  const visible = (mm: Model) =>
    mm.chars.filter((c, i) => !(mm.runs.blocks[c.block].kind === "code" && c.ch === "\n" && (i + 1 === mm.chars.length || mm.chars[i + 1].block !== c.block)));
  const oc = visible(old);
  const nc = visible(nm);
  const norm = (c: { ch: string; kind: string }) => (c.kind === "soft" || c.kind === "hard" ? "\n" : c.ch);
  if (oc.map(norm).join("") !== nc.map(norm).join("")) return "the visible text would change";
  const strip = (s: RunStyle): RunStyle => {
    const t = { ...s };
    for (const k of ignore) (t as Record<string, unknown>)[k] = k === "size" ? 0 : k === "font" ? null : false;
    return t;
  };
  for (let i = 0; i < oc.length; i++) {
    if (styleKey(strip(oc[i].style)) !== styleKey(strip(nc[i].style))) return "the text's formatting would change";
  }
  let r0 = Infinity;
  let r1 = -Infinity;
  for (const b of touched) {
    r0 = Math.min(r0, lineStarts(old.text, b.info.range.start, b.info.range.end)[0]);
    r1 = Math.max(r1, attrEnd(b));
  }
  if (newText.slice(0, r0) !== old.text.slice(0, r0)) return "text before the blocks would change";
  const tail = old.text.length - r1;
  if (newText.slice(newText.length - tail) !== old.text.slice(r1)) return "text after the blocks would change";
  return null;
}

function result(old: Model, t: string, touched: BlockModel[], ignore: (keyof RunStyle)[], from: number, to: number): BlockResult {
  const r = checkBlocks(old, t, touched, ignore);
  if (r !== null) return { ok: false, reason: r };
  // Keep the selection on the same visible characters.
  const nm = buildModel(t);
  const sel = old.chars.map((c, i) => (c.start >= from && c.end <= to ? i : -1)).filter((i) => i >= 0);
  if (sel.length === 0) {
    // A cursor: kept before the same visible character.
    const k = old.chars.findIndex((c) => c.start >= from);
    const pos = k >= 0 && k < nm.chars.length ? nm.chars[k].start : nm.chars.length ? nm.chars[nm.chars.length - 1].end : Math.min(from, t.length);
    void r0Of;
    return { ok: true, text: t, from: pos, to: pos };
  }
  return { ok: true, text: t, from: nm.chars[sel[0]].start, to: nm.chars[sel[sel.length - 1]].end };
}

function r0Of(touched: BlockModel[]): number {
  return Math.min(...touched.map((b) => b.info.range.start));
}

/** Block style: normal text, Heading 1 to 4, Quote or Code block (EDITOR-PLAN 3.3). */
export function setBlockStyle(text: string, from: number, to: number, target: BlockTarget): BlockResult {
  const m = buildModel(text);
  const touched = touchedBlocks(m, from, to).filter((b) => b.info.kind !== "rule");
  if (touched.length === 0) return { ok: false, reason: "there is no text here" };
  const p = new Patch();
  const ignore: (keyof RunStyle)[] = ["size"];
  for (const b of touched) {
    const now = blockStyleOf(b);
    if (now === target) continue;
    const r = b.info.range;
    const src = text.slice(r.start, r.end);
    if (target === "code" || now === "code") {
      ignore.push("code", "font");
      if (target === "code") {
        if (b.info.kind !== "paragraph" || !b.info.topLevel) return { ok: false, reason: "only a paragraph can become a code block" };
        if (m.chars.slice(b.va, b.vb).some((c) => c.style.bold || c.style.italic || c.style.strike || c.style.underline || c.style.color || c.style.bg || c.style.font || c.style.link)) {
          return { ok: false, reason: "a code block cannot keep the text's formatting" };
        }
        const shown = m.chars.slice(b.va, b.vb).map((c) => (c.kind === "soft" || c.kind === "hard" ? "\n" : c.ch)).join("");
        const fence = "`".repeat(Math.max(3, ...(shown.match(/`{3,}/g) ?? []).map((x) => x.length + 1)));
        p.replace(r.start, Math.max(r.end, attrEnd(b)), `${fence}\n${shown}\n${fence}`);
      } else {
        // A code block becomes paragraphs: each line, escaped, is a line of one paragraph.
        const lines = m.chars.slice(b.va, b.vb).map((c) => c.ch).join("").replace(/\n$/, "").split("\n");
        p.replace(r.start, r.end, lines.map((l) => escapeText(l)).join("  \n"));
        if (target !== "paragraph") return { ok: false, reason: "a code block becomes normal text first" };
      }
      continue;
    }
    if (target === "quote") {
      if (b.info.path.includes("/quote")) continue;
      for (const ls of lineStarts(text, r.start, Math.max(r.end, attrEnd(b)))) p.insert(ls, "> ");
      continue;
    }
    // Leaving a quote.
    if (now === "quote" && target === "paragraph") {
      for (const ls of lineStarts(text, r.start, Math.max(r.end, attrEnd(b)))) {
        const q = /^ {0,3}> ?/.exec(text.slice(ls, ls + 6));
        if (q) p.replace(ls, ls + q[0].length, "");
      }
      continue;
    }
    // Headings: one line, `#` marks at its start.
    const atx = /^(#{1,6})([ \t]+|$)/.exec(src);
    const level = target === "paragraph" ? 0 : Number(target.slice(1));
    if (b.info.kind === "heading") {
      if (!atx) return { ok: false, reason: "this heading is written with an underline; change it in Raw" };
      p.replace(r.start, r.start + atx[0].length, level ? "#".repeat(level) + " " : "");
      // A closing sequence of `#` goes too when the heading becomes text.
      const close = /[ \t]+#+[ \t]*$/.exec(src);
      if (!level && close) p.replace(r.end - close[0].length, r.end, "");
    } else {
      // The paragraph's attribute line stays under the heading, as its own (the same style).
      if (/[\r\n]/.test(bodyOf(text, b))) return { ok: false, reason: "a heading is one line; this paragraph has several" };
      if (!level) continue;
      p.insert(r.start, "#".repeat(level) + " ");
    }
  }
  if (p.empty) return { ok: true, text, from, to };
  const t = p.apply(text);
  if (t === null) return { ok: false, reason: "the change could not be made safely" };
  return result(m, t, touched, ignore, from, to);
}

const MARKER: Record<ListKind, (n: number) => string> = {
  bullet: () => "- ",
  ordered: (n) => `${n}. `,
  task: () => "- [ ] ",
};

/** Bulleted, numbered or task list: on for paragraphs, off (or another kind) for list items. */
export function toggleList(text: string, from: number, to: number, kind: ListKind): BlockResult {
  const m = buildModel(text);
  const touched = touchedBlocks(m, from, to).filter((b) => b.info.kind === "paragraph");
  if (touched.length === 0) return { ok: false, reason: "lists are made from normal text" };
  const kinds = touched.map(listKindOf);
  const p = new Patch();
  if (kinds.every((k) => k === kind)) {
    // Off: the items become paragraphs.
    let prevEnd = -1;
    for (const b of touched) {
      const ls = lineStarts(text, b.info.range.start, b.info.range.end)[0];
      const marker = /^( {0,3})([-+*]|\d{1,9}[.)])( {1,4}|\t)(\[[ xX]\] )?/.exec(text.slice(ls, b.info.range.start + 6));
      if (!marker || ls + marker[0].length > b.info.range.start + 6) return { ok: false, reason: "this list is too complex; change it in Raw" };
      p.replace(ls, ls + marker[0].length, "");
      // Each former item is a paragraph of its own: a blank line before it, and after the
      // last one, so that the list around them stays apart.
      const above = ls > 0 ? text.slice(lineStarts(text, ls - 1, ls - 1)[0], ls - 1) : "";
      if (prevEnd >= 0 || (ls > 0 && !isBlank(above))) p.insert(ls, "\n");
      prevEnd = b.info.range.end;
    }
    const lastEnd = Math.max(...touched.map((b) => attrEnd(b)));
    const nl = /^(\r\n|\n|\r)/.exec(text.slice(lastEnd));
    if (nl && /^[^\r\n]*\S/.test(text.slice(lastEnd + nl[0].length).split(/\r\n|\n|\r/)[0] ?? "")) p.insert(lastEnd + nl[0].length, "\n");
  } else if (kinds.every((k) => k !== null)) {
    // Another kind: new markers.
    touched.forEach((b, n) => {
      const ls = lineStarts(text, b.info.range.start, b.info.range.end)[0];
      const marker = /^( {0,3})([-+*]|\d{1,9}[.)])( {1,4}|\t)(\[[ xX]\] )?/.exec(text.slice(ls, b.info.range.start + 6));
      if (marker) p.replace(ls + marker[1].length, ls + marker[0].length, MARKER[kind](n + 1));
    });
  } else if (kinds.every((k) => k === null)) {
    // On: top-level paragraphs become one tight list.
    for (const b of touched) if (!b.info.topLevel) return { ok: false, reason: "only normal paragraphs become a list" };
    touched.forEach((b, n) => {
      const marker = MARKER[kind](n + 1);
      const starts = lineStarts(text, b.info.range.start, Math.max(b.info.range.end, attrEnd(b)));
      p.insert(starts[0], marker);
      for (const ls of starts.slice(1)) p.insert(ls, " ".repeat(marker.length));
      // The blank lines between the paragraphs go, so the list is one list.
      if (n > 0) {
        const prev = touched[n - 1];
        const gap = text.slice(Math.max(prev.info.range.end, attrEnd(prev)), starts[0]);
        if (/^(\r\n|\n|\r)([ \t]*(\r\n|\n|\r))+$/.test(gap)) p.replace(Math.max(prev.info.range.end, attrEnd(prev)), starts[0], gap.match(/^(\r\n|\n|\r)/)![1]);
      }
    });
  } else return { ok: false, reason: "the selection mixes list items and paragraphs" };
  const t = p.apply(text);
  if (t === null) return { ok: false, reason: "the change could not be made safely" };
  return result(m, t, touched, [], from, to);
}

/** Inserts a new block after the block the cursor is in (a table or a horizontal line). */
export function insertBlock(text: string, at: number, what: "table" | "rule"): { text: string; from: number; to: number } {
  const m = buildModel(text);
  const here = touchedBlocks(m, at, at)[0];
  // After the block the cursor is in; on an empty line, right there.
  const pos = here ? Math.max(here.info.range.end, attrEnd(here)) : Math.min(at, text.length);
  const body = what === "table" ? "| Column 1 | Column 2 |\n|---|---|\n| | |" : "---";
  const before = pos === 0 ? "" : text.slice(0, pos).endsWith("\n\n") ? "" : text.slice(0, pos).endsWith("\n") ? "\n" : "\n\n";
  const after = text.slice(pos).startsWith("\n\n") || text.slice(pos) === "" ? "" : text.slice(pos).startsWith("\n") ? "\n" : "\n\n";
  if (what === "rule") {
    // The cursor goes on an empty line under the line, ready for typing.
    const rest = text.slice(pos).replace(/^\n+/, "");
    const head = text.slice(0, pos) + before + body + "\n\n";
    return { text: head + (rest ? "\n\n" + rest : ""), from: head.length, to: head.length };
  }
  // A table at the end of the note gets an empty line under it, so the caret has somewhere to
  // go below the table. Blank lines that were there are kept; only the line ends missing are
  // added (review of alpha's changes, 3). A kept space (U+00A0) is text, not blank (4).
  const rest = text.slice(pos);
  const ends = (rest.match(/\n/g) ?? []).length;
  const t = isBlank(rest) ? text.slice(0, pos) + before + body + (rest.startsWith("\n") ? rest : "") + "\n".repeat(Math.max(0, 2 - ends)) + (rest.startsWith("\n") ? "" : rest) : text.slice(0, pos) + before + body + after + rest;
  const start = pos + before.length + (what === "table" ? 2 : 0);
  return { text: t, from: start, to: start + (what === "table" ? "Column 1".length : 0) };
}
