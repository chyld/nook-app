// SPEC2 7.3 and 7.4: `reduce`, the one entry point for edits in Rich mode and for the toolbar in
// both modes. Each intent wraps version 1's routine; the routines check their own results by
// re-parsing. `reduce` adds the rules version 1 kept in its browser code (7.2) and one rule of its
// own: the edit stays in its region (region.ts).

import { applyStyle, stepSize, type Change, type Result as StyleResult } from "./style/apply.ts";
import { blockStyleAt, insertBlock, listKindAt, seen, setBlockStyle, toggleList, touchedBlocks, type BlockResult, type BlockTarget } from "./style/blocks.ts";
import { cellChars, cellMarkdown, shownLength, styleCellText } from "./style/cells.ts";
import { buildModel, type Model } from "./style/model.ts";
import { addColumn, addRow, parseTable, removeColumn, removeRow, replaceTable, type Grid } from "./style/tables.ts";
import { deleteAt, deleteRange, enter, insertBlocks, leaveCode, lineBreak, lineShortcut, pasteMarkdown, pastePlain, typeText, type Edit } from "./style/typing.ts";
import { setImageWidth, toggleTask } from "./style/widgets.ts";
import { writeSetting } from "./fmwriter.ts";
import { cleanTag, cleanTitle, naturalSize, noteFontOf, noteSizeOf } from "./meta.ts";
import { diff, editWithin, finalTable, frontMatterRegion, inside, regionOf, tablesOf } from "./region.ts";
import { isBlank } from "./style/blank.ts";
import type { Doc, Intent, ListKind, Mode, PendingCell, Result, SavedStyle, Sel, Skipped, TableOp, TextEdit, Typing } from "./types.ts";

const NO_TYPING: Typing = { marks: [], block: null };

export const REFUSE_SELECT = "Select some text first";

type Out = { text: string; sel: Sel; typing?: Typing; then?: Intent; skipped?: Skipped };
type Step = Out | { reason: string };

const isOut = (s: Step): s is Out => !("reason" in s);

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason: humane(reason) };
}

/** A reason as the person reads it: a sentence, capitalised, without a final full stop. */
function humane(reason: string): string {
  const r = reason.trim().replace(/\.$/, "");
  return r.charAt(0).toUpperCase() + r.slice(1);
}

const caret = (p: number): Sel => ({ anchor: p, head: p });

function fromEdit(e: Edit): Step {
  if (!e.ok) return { reason: e.reason };
  return { text: e.text, sel: { anchor: e.anchor ?? e.cursor, head: e.cursor } };
}

function fromRange(r: BlockResult | StyleResult, backwards = false): Step {
  if (!r.ok) return { reason: r.reason };
  const sel = backwards ? { anchor: r.to, head: r.from } : { anchor: r.from, head: r.to };
  return { text: r.text, sel, ...("skipped" in r && r.skipped.count ? { skipped: r.skipped } : {}) };
}

/** Maps a position of the old text through one edit (7.4.6). */
export function mapPos(pos: number, e: TextEdit | null, assoc: -1 | 1 = 1): number {
  if (!e) return pos;
  if (pos < e.from) return pos;
  if (pos > e.to) return pos + e.insert.length - (e.to - e.from);
  if (pos === e.from && pos === e.to) return assoc > 0 ? pos + e.insert.length : pos;
  if (pos === e.from) return pos;
  return e.from + e.insert.length;
}

function mapSel(sel: Sel, oldText: string, newText: string): Sel {
  const e = diff(oldText, newText);
  return { anchor: Math.min(mapPos(sel.anchor, e, -1), newText.length), head: Math.min(mapPos(sel.head, e, -1), newText.length) };
}

// --- typing.marks (7.4.3) ---------------------------------------------------------------------

/** Adds a mark for what is typed next: it replaces one of the same kind (size and a size step
 *  replace each other). */
export function addMark(marks: Change[], change: Change): Change[] {
  // A clear undoes what was waiting before it; a later mark keeps a waiting clear, as version 1's
  // `addPending` did (version 2 code review, 18).
  if (change.kind === "clear") return [change];
  const rest = marks.filter((c) => c.kind !== change.kind && !(c.kind === "size" && change.kind === "size-step") && !(c.kind === "size-step" && change.kind === "size"));
  return [...rest, change];
}

/**
 * 7.4.3: what Enter carries on (version 1's `styleToCarry`): the waiting marks if there are
 * any; otherwise, only when the caret was at the end of its paragraph, the style of the
 * character before it, without bold in a heading, without underline on a link, without a size
 * equal to the note's size or any size in a heading, and nothing out of code.
 */
export function styleToCarry(m: Model, sel: Sel, typing: Typing): Change[] {
  if (typing.marks.length) return typing.marks;
  if (sel.anchor !== sel.head) return [];
  const p = sel.head;
  const before = m.chars.filter((c) => c.end <= p).pop();
  if (!before || m.chars.some((c) => c.start >= p && c.block === before.block)) return [];
  const block = m.runs.blocks[before.block];
  if (block.kind === "code" || before.style.code) return [];
  const st = before.style;
  const out: Change[] = [];
  if (st.bold && block.kind !== "heading") out.push({ kind: "bold", on: true });
  if (st.italic) out.push({ kind: "italic", on: true });
  if (st.underline && !st.link) out.push({ kind: "underline", on: true });
  if (st.strike) out.push({ kind: "strike", on: true });
  if (st.color) out.push({ kind: "color", value: st.color });
  if (st.bg) out.push({ kind: "bg", value: st.bg });
  if (st.font) out.push({ kind: "font", value: st.font });
  if (block.kind !== "heading" && Math.abs(st.size - noteSizeOf(m)) > 0.01) out.push({ kind: "size", pt: Math.round(st.size * 10) / 10 });
  return out;
}

// --- the size and font shown at the caret, for `−`, `+` and saved styles -------------------------

/** The character whose style the caret shows (version 1's `selectionState`): the one before
 *  it, or after it at the start of a block. */
export function caretChar(m: Model, p: number) {
  const before = m.chars.filter((c) => c.end <= p).pop();
  const after = m.chars.find((c) => c.start >= p);
  return before && (!after || before.block === after.block || after.start > p) ? before : after;
}

/** The size shown in the box with nothing selected: a waiting size, else the caret's. */
export function shownSize(m: Model, p: number, typing: Typing): number {
  for (let i = typing.marks.length - 1; i >= 0; i--) {
    const c = typing.marks[i];
    // A size that is only the block's own, with a heading waiting on an empty line: the heading's.
    const h = c.kind === "size" && c.own ? /^h([1-6])$/.exec(typing.block ?? "") : null;
    if (h) return Math.round(naturalSize(m, { kind: "heading", level: Number(h[1]) }) * 10) / 10;
    if (c.kind === "size") return c.pt;
  }
  const c = caretChar(m, p);
  return c ? Math.round(c.style.size * 10) / 10 : noteSizeOf(m);
}

/** The block style at the caret's line, for "Default (reset)": a heading keeps its size. */
function lineSize(m: Model, from: number, to: number): number {
  const k = /^h([1-6])$/.exec(blockStyleAt(m.text, from, to) ?? "");
  return k ? naturalSize(m, { kind: "heading", level: Number(k[1]) }) : noteSizeOf(m);
}

/** Version 1's `changesOf`: a saved style as changes, one per property. */
export function changesOf(s: SavedStyle, noteSize: number): Change[] {
  return [
    { kind: "font", value: s.font },
    { kind: "size", pt: s.size ?? noteSize },
    { kind: "bold", on: s.bold },
    { kind: "italic", on: s.italic },
    { kind: "underline", on: s.underline },
    { kind: "strike", on: s.strike },
    { kind: "color", value: s.color },
    { kind: "bg", value: s.bg },
  ];
}

const PLAIN_STYLE: SavedStyle = { name: "Default", bold: false, italic: false, underline: false, strike: false, size: null, font: null, color: null, bg: null };

// --- block styles and lists (7.2, 7.6) --------------------------------------------------------

/** The line [from, to) holding a position. */
function lineAt(text: string, p: number): { from: number; to: number; text: string; number: number } {
  let a = p;
  while (a > 0 && text[a - 1] !== "\n") a--;
  let z = p;
  while (z < text.length && text[z] !== "\n") z++;
  let number = 1;
  for (let i = 0; i < a; i++) if (text[i] === "\n") number++;
  return { from: a, to: z, text: text.slice(a, z), number };
}

function prevLine(text: string, line: { from: number }): string | null {
  if (line.from === 0) return null;
  return lineAt(text, line.from - 1).text;
}

function nextLine(text: string, line: { to: number }): string | null {
  if (line.to >= text.length) return null;
  return lineAt(text, line.to + 1).text;
}

/** The text to put on an empty line so that what is typed there is a block of this kind. */
const START: Record<BlockTarget, [string, string]> = {
  paragraph: ["", ""], h1: ["# ", ""], h2: ["## ", ""], h3: ["### ", ""], h4: ["#### ", ""], h5: ["##### ", ""], h6: ["###### ", ""],
  quote: ["> ", ""], code: ["```\n", "\n```"],
};

const LOOK = ["color", "bg", "font", "size", "underline"] as const;
const sameLook = (k: (typeof LOOK)[number], a: Model["chars"][number]["style"], b: Model["chars"][number]["style"]) => (k === "size" ? Math.abs(a.size - b.size) < 0.01 : a[k] === b[k]);

/**
 * A quote and a list item have no attribute line (the note format): a paragraph whose style is
 * one cannot become either as it is. So, when the change is refused: the attribute lines of the
 * touched paragraphs are taken off, the change is made, and every character is given its look
 * again, which `applyStyle` writes there as spans. The visible text and each character's style
 * are the same after as before, or the first refusal stands.
 */
function keepingStyle(text: string, from: number, to: number, change: (t: string, f: number, z: number) => BlockResult): BlockResult {
  const first = change(text, from, to);
  if (first.ok) return first;
  const old = buildModel(text);
  const cuts: [number, number][] = [];
  for (const b of touchedBlocks(old, from, to)) {
    const attrs = (b.block as { attributes?: { target: string; range: { start: number; end: number } } } | null)?.attributes;
    const a = attrs?.range;
    const r = b.info.range;
    // Only a paragraph's own style: an image's attribute line (its width) is not a look that spans can carry.
    if (b.info.kind !== "paragraph" || !a || attrs?.target !== "paragraph" || a.start <= r.start || a.start > r.end) continue;
    // From the end of the paragraph's last line of text to the end of the attribute line.
    let s = a.start;
    while (s > r.start && (text[s - 1] === " " || text[s - 1] === "\t")) s--;
    if (text[s - 1] === "\n") s--;
    if (text[s - 1] === "\r") s--;
    cuts.push([s, a.end]);
  }
  if (!cuts.length) return first;
  let bare = text;
  const at = (p: number) => cuts.reduce((q, [s, e]) => (p >= e ? q - (e - s) : p > s ? q - (p - s) : q), p);
  for (const [s, e] of [...cuts].reverse()) bare = bare.slice(0, s) + bare.slice(e);
  const made = change(bare, at(from), at(to));
  if (!made.ok) return first;
  let cur = made.text;
  let now = buildModel(cur);
  for (let guard = 0; guard < 400; guard++) {
    if (now.chars.length !== old.chars.length) return first;
    // The first run of characters of one block that lost one part of their look, all to the same value.
    let i = -1;
    let key: (typeof LOOK)[number] = "color";
    for (let k = 0; k < old.chars.length && i < 0; k++) {
      const lost = LOOK.find((p) => !sameLook(p, old.chars[k].style, now.chars[k].style));
      if (lost) [i, key] = [k, lost];
    }
    if (i < 0) break;
    let j = i;
    while (j + 1 < old.chars.length && old.chars[j + 1].block === old.chars[i].block && sameLook(key, old.chars[j + 1].style, old.chars[i].style) && !sameLook(key, old.chars[j + 1].style, now.chars[j + 1].style)) j++;
    const want = old.chars[i].style;
    const c: Change = key === "size" ? { kind: "size", pt: Math.round(want.size * 10) / 10 } : key === "underline" ? { kind: "underline", on: want.underline } : { kind: key, value: want[key] };
    const next = applyStyle(cur, now.chars[i].start, now.chars[j].end, c);
    if (!next.ok || next.text === cur) return first;
    cur = next.text;
    now = buildModel(cur);
  }
  const same = old.chars.every((c, k) => {
    const n = now.chars[k];
    return n.ch === c.ch && LOOK.every((p) => sameLook(p, c.style, n.style)) && n.style.bold === c.style.bold && n.style.italic === c.style.italic && n.style.strike === c.style.strike && n.style.code === c.style.code && n.style.link === c.style.link && n.kind === c.kind && (n.image?.width ?? null) === (c.image?.width ?? null) && n.image?.destination === c.image?.destination;
  });
  if (!same || !now.chars.length) return first;
  // The selection stays on the same visible characters; a caret after the character it was after.
  // (Only the characters the person sees: not the line that ends a code block's last line.)
  const shown = new Set(seen(old));
  const inside = old.chars.map((c, k) => (shown.has(c) && c.start >= from && c.end <= to ? k : -1)).filter((k) => k >= 0);
  if (from !== to && inside.length) return { ok: true, text: cur, from: now.chars[inside[0]].start, to: now.chars[inside[inside.length - 1]].end };
  // A caret: after the visible character it is after, in its own block; at the block's start, before its first one.
  const mine = (k: number) => touchedBlocks(old, from, to).some((b) => k >= b.va && k < b.vb);
  const after = old.chars.findIndex((c) => c.start >= from);
  let before = -1;
  old.chars.forEach((c, k) => {
    if (c.end <= from) before = k;
  });
  const p = before >= 0 && mine(before) ? now.chars[before].end : after >= 0 ? now.chars[after].start : now.chars[now.chars.length - 1].end;
  return { ok: true, text: cur, from: p, to: p };
}

/** Version 1's `change()`: whatever the block had goes first, then the new style. */
function changeBlock(t: string, f: number, to: number, kind: BlockTarget): BlockResult {
  if (blockStyleAt(t, f, to) === kind) return { ok: true, text: t, from: f, to };
  let r = setBlockStyle(t, f, to, "paragraph");
  for (let i = 0; i < 3 && r.ok && blockStyleAt(r.text, r.from, r.to) !== "paragraph"; i++) {
    const next = setBlockStyle(r.text, r.from, r.to, "paragraph");
    if (!next.ok || next.text === r.text) break;
    r = next;
  }
  if (!r.ok || kind === "paragraph") return r;
  return kind === "quote" ? keepingStyle(r.text, r.from, r.to, (x, a, z) => setBlockStyle(x, a, z, kind)) : setBlockStyle(r.text, r.from, r.to, kind);
}

function writeStart(text: string, p: number, kind: BlockTarget): Out {
  const line = lineAt(text, p);
  const [a, z] = START[kind];
  const at = line.from + a.length;
  return { text: text.slice(0, line.from) + a + z + text.slice(line.to), sel: caret(at) };
}

function setBlock(doc: Doc, kind: BlockTarget, mode: Mode): Step {
  const { text, sel } = doc;
  const from = Math.min(sel.anchor, sel.head);
  const to = Math.max(sel.anchor, sel.head);
  const empty = from === to;
  const line = lineAt(text, sel.head);
  // On an empty line there is nothing to change: the style is for what is typed next.
  if (empty && isBlank(line.text) && blockStyleAt(text, from, to) === null) {
    if (mode === "rich") return { text, sel, typing: { marks: doc.typing.marks, block: kind === "paragraph" ? null : kind } };
    return writeStart(text, sel.head, kind);
  }
  // Out of a code block: its text becomes the new style when it can; when it cannot, or the
  // caret is on its empty last line, the caret moves to a new line under the block (`leaveCode`)
  // and the style is for what is typed there.
  if (empty && blockStyleAt(text, from, to) === "code" && kind !== "code") {
    const r = isBlank(line.text) ? null : setBlockStyle(text, from, to, "paragraph");
    if (!r || !r.ok) {
      const out = leaveCode(text, sel.head);
      if (!out) return { reason: "the code block could not be left here; edit it in Raw" };
      if (mode === "raw" && kind !== "paragraph") {
        const w = writeStart(out.text, out.cursor, kind);
        return w;
      }
      return { text: out.text, sel: caret(out.cursor), typing: { marks: [], block: kind === "paragraph" ? null : kind } };
    }
  }
  const out = fromRange(changeBlock(text, from, to, kind), sel.anchor > sel.head);
  // A style waiting at the caret is for what is typed next, in whichever block the line now is;
  // code takes no style, so nothing is left waiting there. A waiting size that is only the old
  // block's own (a style that names no size) becomes the new block's.
  if (empty && isOut(out) && doc.typing.marks.length && kind !== "code") {
    const now = lineSize(buildModel(out.text), out.sel.head, out.sel.head);
    out.typing = { marks: doc.typing.marks.map((c): Change => (c.kind === "size" && c.own ? { kind: "size", pt: now, own: true } : c)), block: null };
  }
  return out;
}

const ITEM = /^(\s*)(- \[[ xX]\] |[-*+] |\d+[.)] )/;
const MARK: Record<Exclude<ListKind, "none">, string> = { bullet: "- ", ordered: "1. ", task: "- [ ] " };

/** The kind of an item that has its mark and no text yet, or null. */
function emptyItem(line: string): Exclude<ListKind, "none"> | null {
  const m = /^(- \[[ xX]\]|[-*+]|\d+[.)]) ?$/.exec(line);
  return !m ? null : m[1].startsWith("- [") ? "task" : /\d/.test(m[1]) ? "ordered" : "bullet";
}

/** The list kind at the selection: the touched items', or an empty item's at the caret. */
export function listAt(text: string, from: number, to: number): ListKind {
  const lk = listKindAt(text, from, to);
  if (lk) return lk;
  // As `toggleList` sees it: the touched paragraphs only (a heading or a table beside them is
  // not part of the list). Found by the property test (review, 36).
  const paras = touchedBlocks(buildModel(text), from, to).filter((b) => b.info.kind === "paragraph");
  if (paras.length) {
    const kinds = new Set(paras.map((b) => listKindAt(text, b.info.range.start, b.info.range.start)));
    if (kinds.size === 1 && [...kinds][0]) return [...kinds][0]!;
  }
  if (from === to) return emptyItem(lineAt(text, from).text) ?? "none";
  return "none";
}

/** Version 1's `list()`: on an empty line or an empty item the marker is written, changed or
 *  removed directly; otherwise `toggleList`. */
function listOn(text: string, sel: Sel, kind: Exclude<ListKind, "none">): Step {
  const from = Math.min(sel.anchor, sel.head);
  const to = Math.max(sel.anchor, sel.head);
  const line = lineAt(text, sel.head);
  const had = emptyItem(line.text);
  const blank = isBlank(line.text) && blockStyleAt(text, from, to) === null && listKindAt(text, from, to) === null;
  if (from === to && (blank || had)) {
    let mark = had === kind ? "" : MARK[kind];
    const prev = prevLine(text, line) ?? "";
    const next = nextLine(text, line) ?? "";
    // A numbered item carries on from the one above it.
    const n = /^(\d+)[.)] /.exec(prev);
    if (mark && kind === "ordered" && n) mark = `${Number(n[1]) + 1}. `;
    // A mark straight under a line of text would be read as part of that text.
    const pre = mark && !isBlank(prev) && !ITEM.test(prev) ? "\n" : "";
    const post = mark && !isBlank(next) && !ITEM.test(next) ? "\n" : "";
    const at = line.from + pre.length + mark.length;
    return { text: text.slice(0, line.from) + pre + mark + post + text.slice(line.to), sel: caret(at) };
  }
  return fromRange(keepingStyle(text, from, to, (x, a, z) => toggleList(x, a, z, kind)), sel.anchor > sel.head);
}

function setList(doc: Doc, kind: ListKind): Step {
  const from = Math.min(doc.sel.anchor, doc.sel.head);
  const to = Math.max(doc.sel.anchor, doc.sel.head);
  const now = listAt(doc.text, from, to);
  // Intents set a value; `toggleList` toggles (7.3).
  if (kind === now) return { text: doc.text, sel: doc.sel };
  const out = listOn(doc.text, doc.sel, kind === "none" ? (now as Exclude<ListKind, "none">) : kind);
  // A style waiting at the caret is for what is typed next, in the item or out of it (as `setBlock`).
  if (from === to && isOut(out) && doc.typing.marks.length) {
    const size = lineSize(buildModel(out.text), out.sel.head, out.sel.head);
    out.typing = { marks: doc.typing.marks.map((c): Change => (c.kind === "size" && c.own ? { kind: "size", pt: size, own: true } : c)), block: null };
  }
  return out;
}

// --- styles -----------------------------------------------------------------------------------

function setMark(doc: Doc, change: Change, mode: Mode, m: Model): Step {
  const from = Math.min(doc.sel.anchor, doc.sel.head);
  const to = Math.max(doc.sel.anchor, doc.sel.head);
  // 7.6: a size outside 1 to 400, or with more than one decimal, is refused, with a selection or
  // without one (version 2 code review, 19).
  if (change.kind === "size" && (!(change.pt >= 1 && change.pt <= 400) || Math.round(change.pt * 10) !== change.pt * 10)) {
    return { reason: "a size is a number from 1 to 400, with one decimal at most" };
  }
  if (from === to) {
    if (mode === "raw" || change.kind === "link") return { reason: REFUSE_SELECT };
    // 7.6: with no selection, `−` and `+` set the shown size plus or minus 1.
    const c: Change = change.kind === "size-step" ? { kind: "size", pt: stepSize(shownSize(m, doc.sel.head, doc.typing), change.dir) } : change;
    return { text: doc.text, sel: doc.sel, typing: { marks: addMark(doc.typing.marks, c), block: doc.typing.block } };
  }
  // Bold, italic, underline or strike that every selected character already has (or, off, none
  // has) changes nothing: the routine would write the same look in other markup, so a setting
  // would not be idempotent (7.4; found by the property test, review of alpha's changes).
  if (change.kind === "bold" || change.kind === "italic" || change.kind === "underline" || change.kind === "strike") {
    const kind = change.kind;
    // Bold and italic do not show on white space (the routines' own rule), so a space is not counted.
    const shows = (c: { ch: string }) => !((kind === "bold" || kind === "italic") && /^\s$/u.test(c.ch));
    const chosen = m.chars.filter((c) => c.start >= from && c.end <= to && c.kind !== "soft" && c.kind !== "hard" && shows(c));
    if (chosen.length && chosen.every((c) => c.style[kind] === change.on)) return { text: doc.text, sel: doc.sel };
  }
  return fromRange(applyStyle(doc.text, from, to, change), doc.sel.anchor > doc.sel.head);
}

function useStyle(doc: Doc, style: SavedStyle | "reset", mode: Mode, m: Model): Step {
  const from = Math.min(doc.sel.anchor, doc.sel.head);
  const to = Math.max(doc.sel.anchor, doc.sel.head);
  const reset = style === "reset";
  // 9.4: "Default (reset)" with a selection clears its formatting.
  if (reset && from !== to) return setMark(doc, { kind: "clear" }, mode, m);
  const s = reset ? PLAIN_STYLE : style;
  // A style that names no size, like the reset, leaves the size the block gives: a heading keeps its own.
  const changes = changesOf(s, noteSizeOf(m)).map((c): Change => (s.size === null && c.kind === "size" ? { kind: "size", pt: lineSize(m, from, to), own: true } : c));
  if (from === to) {
    if (mode === "raw") return { reason: REFUSE_SELECT };
    return { text: doc.text, sel: doc.sel, typing: { marks: changes, block: doc.typing.block } };
  }
  // On a selection: one property after another, as one change to the note.
  let cur: { text: string; from: number; to: number } = { text: doc.text, from, to };
  const reasons: string[] = [];
  for (const c of changes) {
    const next = applyStyle(cur.text, cur.from, cur.to, c);
    if (next.ok) {
      cur = next;
      reasons.push(...next.skipped.reasons);
    }
  }
  const back = doc.sel.anchor > doc.sel.head;
  const uniq = [...new Set(reasons)];
  return { text: cur.text, sel: back ? { anchor: cur.to, head: cur.from } : { anchor: cur.from, head: cur.to }, ...(uniq.length ? { skipped: { count: uniq.length, reasons: uniq } } : {}) };
}

function setLink(doc: Doc, href: string | null): Step {
  const from = Math.min(doc.sel.anchor, doc.sel.head);
  const to = Math.max(doc.sel.anchor, doc.sel.head);
  if (from === to) return { reason: REFUSE_SELECT };
  if (href !== null) {
    href = href.trim();
    if (!/^(https?:|mailto:)/i.test(href)) return { reason: "a link starts with https://, http:// or mailto:" };
  }
  return fromRange(applyStyle(doc.text, from, to, { kind: "link", url: href }), doc.sel.anchor > doc.sel.head);
}

// --- typing (7.4.3, 7.4.4, 7.6) ---------------------------------------------------------------

const BLOCK_NAME: Record<BlockTarget, string> = { paragraph: "Normal text", h1: "Heading 1", h2: "Heading 2", h3: "Heading 3", h4: "Heading 4", h5: "Heading 5", h6: "Heading 6", quote: "Quote", code: "Code block" };

function insertText(doc: Doc, ins: string): Step {
  const from = Math.min(doc.sel.anchor, doc.sel.head);
  const to = Math.max(doc.sel.anchor, doc.sel.head);
  const waiting = doc.typing.marks;
  let r = typeText(doc.text, from, to, ins, waiting);
  // Spaces where Markdown does not keep them (on an empty line, at a paragraph's start): they
  // go in as no-break spaces, which it keeps and shows. A tab there is four of them.
  if (!r.ok && /^[ \t]+$/.test(ins)) {
    const kept = typeText(doc.text, from, to, ins.replace(/\t/g, "    ").replace(/ /g, "\u00a0"), waiting);
    if (kept.ok) r = kept;
  }
  // A block style chosen on an empty line: the first thing typed there starts that block.
  const kind = doc.typing.block;
  let refused = "";
  if (r.ok && kind && kind !== "paragraph" && !isBlank(ins)) {
    const at = r.cursor;
    const b = kind === "quote" ? keepingStyle(r.text, at, at, (x, a, z) => setBlockStyle(x, a, z, kind)) : setBlockStyle(r.text, at, at, kind);
    // In a new code block the caret belongs after the text, not on the closing fence's line.
    const onFence = b.ok && kind === "code" && b.text[b.from - 1] === "\n" && b.text[b.from] === "`";
    if (b.ok) r = { ok: true, text: b.text, cursor: onFence ? b.from - 1 : b.from };
    // The text is typed all the same; the person is told why it is not the block they chose.
    else refused = `${BLOCK_NAME[kind]} was not applied${waiting.length ? " with this style" : ""}: ${b.reason}`;
  }
  const step = fromEdit(r);
  if (!isOut(step)) return step;
  if (refused) step.skipped = { count: 1, reasons: [refused] };
  // A space typed alone leaves `typing` waiting for the next letter. (A no-break space is text:
  // SPEC-NOTES, "The kept space".)
  const alone = /^[ \t]+$/.test(ins);
  step.typing = alone ? { marks: waiting, block: kind } : NO_TYPING;
  // 7.6: after a space or a backtick, a line that is now a shortcut becomes its block, as `then`.
  if (/^[ `]$/.test(ins)) {
    const sc = lineShortcut(step.text, step.sel.head);
    if (sc && sc.ok) step.then = { type: "shortcut" };
  }
  return step;
}

function rawReplace(doc: Doc, ins: string): Out {
  const from = Math.min(doc.sel.anchor, doc.sel.head);
  const to = Math.max(doc.sel.anchor, doc.sel.head);
  return { text: doc.text.slice(0, from) + ins + doc.text.slice(to), sel: caret(from + ins.length) };
}

function rawDelete(doc: Doc, dir: -1 | 1, word: boolean): Out {
  const from = Math.min(doc.sel.anchor, doc.sel.head);
  const to = Math.max(doc.sel.anchor, doc.sel.head);
  const t = doc.text;
  if (from !== to) return { text: t.slice(0, from) + t.slice(to), sel: caret(from) };
  if (dir < 0) {
    if (from === 0) return { text: t, sel: doc.sel };
    let a = from - 1;
    if (a > 0 && /[\udc00-\udfff]/.test(t[a]) && /[\ud800-\udbff]/.test(t[a - 1])) a--;
    if (word) {
      a = from;
      while (a > 0 && /\s/.test(t[a - 1])) a--;
      while (a > 0 && !/\s/.test(t[a - 1])) a--;
    }
    return { text: t.slice(0, a) + t.slice(from), sel: caret(a) };
  }
  if (from >= t.length) return { text: t, sel: doc.sel };
  let z = from + 1;
  if (/[\ud800-\udbff]/.test(t[from]) && /[\udc00-\udfff]/.test(t[z] ?? "")) z++;
  if (word) {
    z = from;
    while (z < t.length && /\s/.test(t[z])) z++;
    while (z < t.length && !/\s/.test(t[z])) z++;
  }
  return { text: t.slice(0, from) + t.slice(z), sel: caret(from) };
}

function richDelete(doc: Doc, dir: -1 | 1, word: boolean): Step {
  const from = Math.min(doc.sel.anchor, doc.sel.head);
  const to = Math.max(doc.sel.anchor, doc.sel.head);
  return fromEdit(from === to ? deleteAt(doc.text, doc.sel.head, dir, word) : deleteRange(doc.text, from, to));
}

// --- tables (7.7) -----------------------------------------------------------------------------

/** The table holding a position: its source range and its grid. */
export function tableAt(m: Model, at: number): { from: number; to: number; grid: Grid | null } | null {
  for (const t of tablesOf(m)) {
    let ls = t.start;
    while (ls > 0 && m.text[ls - 1] !== "\n") ls--;
    if (at >= ls && at <= t.end) {
      // The pipe table's lines start at the line's start (the grid keeps their indent).
      const from = /^ {0,3}$/.test(m.text.slice(ls, t.start)) ? ls : t.start;
      return { from, to: t.end, grid: parseTable(m.text.slice(from, t.end)) };
    }
  }
  return null;
}

function cellText(c: PendingCell | (TableOp & { op: "setCell" | "setCellSource" })): { ok: true; text: string } | { ok: false; reason: string } {
  if ("runs" in c) return cellMarkdown(c.runs);
  return { ok: true, text: c.markdown.replace(/\s*[\r\n]+\s*/g, " ").trim() };
}

function setCellIn(g: Grid, row: number, col: number, text: string): Grid | null {
  if (row < 0 || row >= g.rows.length || col < 0 || col >= g.align.length) return null;
  return { ...g, rows: g.rows.map((r, i) => (i === row ? r.map((c, j) => (j === col ? text : c)) : r)) };
}

/** A style in a cell. Intents set a value; `styleCellText` toggles, so it is called only when
 *  the value must change (and twice to turn a style off over a mixed selection). */
function styleInCell(source: string, from: number, to: number, change: Change): { ok: true; text: string; from: number; to: number } | { ok: false; reason: string } {
  const all = shownLength(source);
  if (all === 0) return { ok: false, reason: "type something in the cell first" };
  if (from === to) {
    from = 0;
    to = all;
  }
  from = Math.max(0, Math.min(from, all));
  to = Math.max(from, Math.min(to, all));
  if ("on" in change) {
    const chars = cellChars(source) ?? [];
    const kind = change.kind as "bold";
    const sel = chars.slice(from, to);
    const every = sel.length > 0 && sel.every((c) => c.style[kind]);
    const none = sel.every((c) => !c.style[kind]);
    if (change.on ? every : none) return { ok: true, text: source, from, to };
    if (!change.on && !every) {
      const first = styleCellText(source, from, to, change);
      if (!first.ok) return first;
      source = first.text;
    }
  }
  const r = styleCellText(source, from, to, change);
  if (!r.ok) return r;
  return { ok: true, text: r.text, from: r.from ?? from, to: r.to ?? to };
}

function tableEdit(doc: Doc, m: Model, at: number, op: TableOp, pending?: PendingCell): Step {
  const t = tableAt(m, at);
  if (!t) return { reason: "there is no table here" };
  if (!t.grid) return { reason: "this table can only be edited as text" };
  let g: Grid = t.grid;
  const named = new Set<string>();
  if (pending) {
    const c = cellText(pending);
    if (!c.ok) return { reason: c.reason };
    const next = setCellIn(g, pending.row, pending.col, c.text);
    if (!next) return { reason: "there is no such cell" };
    g = next;
    named.add(`${pending.row}:${pending.col}`);
  }
  let cellSel: { row: number; col: number; from: number; to: number } | null = null;
  let shape = false;
  switch (op.op) {
    case "setCell":
    case "setCellSource": {
      const c = cellText(op);
      if (!c.ok) return { reason: c.reason };
      const next = setCellIn(g, op.row, op.col, c.text);
      if (!next) return { reason: "there is no such cell" };
      g = next;
      named.add(`${op.row}:${op.col}`);
      break;
    }
    case "styleCell": {
      const src = g.rows[op.row]?.[op.col];
      if (src === undefined) return { reason: "there is no such cell" };
      const r = styleInCell(src, Math.min(op.from, op.to), Math.max(op.from, op.to), op.change);
      if (!r.ok) return { reason: r.reason };
      g = setCellIn(g, op.row, op.col, r.text)!;
      named.add(`${op.row}:${op.col}`);
      cellSel = { row: op.row, col: op.col, from: r.from, to: r.to };
      break;
    }
    case "addRow":
      g = addRow(g, op.after);
      shape = true;
      break;
    case "addColumn":
      g = addColumn(g, op.after);
      shape = true;
      break;
    case "removeRow": {
      const next = removeRow(g, op.row);
      if (!next) return { reason: "a table keeps its header row" };
      g = next;
      shape = true;
      break;
    }
    case "removeColumn": {
      const next = removeColumn(g, op.col);
      if (!next) return { reason: "a table keeps at least one column" };
      g = next;
      shape = true;
      break;
    }
  }
  // An operation that changes no cell writes nothing (version 1 writes only a changed table).
  if (!shape && JSON.stringify(g.rows) === JSON.stringify(t.grid.rows)) return { text: doc.text, sel: doc.sel };
  const r = replaceTable(doc.text, t.from, t.to, g);
  if (!r.ok) return { reason: r.reason };
  // 7.7: parsed again, every cell the operation did not name holds what it held before.
  const back = parseTable(r.text.slice(r.from, r.to));
  if (!back) return { reason: "the table would not read as a table any more; use Edit as text" };
  if (!shape) {
    const before = t.grid.rows;
    for (let i = 0; i < before.length; i++) {
      for (let j = 0; j < before[i].length; j++) {
        if (named.has(`${i}:${j}`)) continue;
        if (back.rows[i]?.[j] !== before[i][j]) return { reason: "another cell would change; use Edit as text" };
      }
    }
  } else if (!shapeKept(t.grid, back, op, named)) return { reason: "another cell would change; use Edit as text" };
  void cellSel;
  return { text: r.text, sel: mapSel(doc.sel, doc.text, r.text) };
}

/** For row and column operations: the cells outside the added or removed row or column hold
 *  what they held, in their new places. */
function shapeKept(old: Grid, now: Grid, op: TableOp, named: Set<string>): boolean {
  const map = (i: number, j: number): [number, number] | null => {
    switch (op.op) {
      case "addRow":
        return [i > Math.max(0, op.after) || (op.after < 1 && i >= 1) ? i + 1 : i, j];
      case "removeRow":
        return i === op.row ? null : [i > op.row ? i - 1 : i, j];
      case "addColumn":
        return [i, j > op.after ? j + 1 : j];
      case "removeColumn":
        return j === op.col ? null : [i, j > op.col ? j - 1 : j];
      default:
        return [i, j];
    }
  };
  for (let i = 0; i < old.rows.length; i++) {
    for (let j = 0; j < old.rows[i].length; j++) {
      if (named.has(`${i}:${j}`)) continue;
      const to = map(i, j);
      if (!to) continue;
      if (now.rows[to[0]]?.[to[1]] !== old.rows[i][j]) return false;
    }
  }
  return true;
}

/**
 * Change 12: a place to type under a table that ends the note. Only line ends are added, at the
 * note's end, until a blank line follows the table's last line (what is there is kept); the caret
 * goes to the end. Refused when the note does not end in a table.
 */
function lineAfterTable(doc: Doc, m: Model): Step {
  const t = finalTable(m);
  if (!t) return { reason: "the note does not end in a table" };
  const rest = doc.text.slice(t.end);
  const add = "\n".repeat(Math.max(0, 2 - (rest.match(/\n/g) ?? []).length));
  const text = doc.text + add;
  // Nothing visible changes, and the table is still the last block.
  const next = buildModel(text);
  if (!visibleKept(m, next) || next.chars.length !== m.chars.length || !finalTable(next)) return { reason: "a line cannot be added under this table; add it in Raw" };
  return { text, sel: caret(text.length) };
}

// --- checks for routines that give none (7.4.1) -------------------------------------------------

/** The visible text of `old` is kept in `next`, with one run of characters added. */
function visibleKept(old: Model, next: Model): boolean {
  const a = old.chars;
  const b = next.chars;
  if (b.length < a.length) return false;
  let p = 0;
  while (p < a.length && a[p].ch === b[p].ch) p++;
  let s = 0;
  while (s < a.length - p && a[a.length - 1 - s].ch === b[b.length - 1 - s].ch) s++;
  return p + s >= a.length;
}

// --- reduce -----------------------------------------------------------------------------------

/** The intents of the toolbar and the widgets, which never write into the front matter: only
 *  `setMeta` does (4.2). In Raw mode the caret can stand in it. */
const NOT_IN_FRONT_MATTER = new Set<Intent["type"]>(["setMark", "applyStyle", "setBlock", "setList", "setLink", "insertBlock", "insertPhoto", "shortcut", "setImageWidth", "toggleTask", "tableEdit"]);
export const REFUSE_FRONT_MATTER = "this is the note's front matter: its settings are changed in the header, or edited as text";

function step(doc: Doc, intent: Intent, mode: Mode, m: Model): Step {
  const rich = mode === "rich";
  if (NOT_IN_FRONT_MATTER.has(intent.type)) {
    const end = frontMatterRegion(doc.text)[1];
    if (end > 0 && Math.min(doc.sel.anchor, doc.sel.head) < end) return { reason: REFUSE_FRONT_MATTER };
  }
  switch (intent.type) {
    case "insertText":
      return rich ? insertText(doc, intent.text) : rawReplace(doc, intent.text);
    case "deleteBackward":
      return rich ? richDelete(doc, -1, false) : rawDelete(doc, -1, false);
    case "deleteForward":
      return rich ? richDelete(doc, 1, false) : rawDelete(doc, 1, false);
    case "deleteWordBackward":
      return rich ? richDelete(doc, -1, true) : rawDelete(doc, -1, true);
    case "deleteWordForward":
      return rich ? richDelete(doc, 1, true) : rawDelete(doc, 1, true);
    case "cut": {
      const from = Math.min(doc.sel.anchor, doc.sel.head);
      const to = Math.max(doc.sel.anchor, doc.sel.head);
      if (from === to) return { text: doc.text, sel: doc.sel };
      return rich ? fromEdit(deleteRange(doc.text, from, to)) : rawDelete(doc, -1, false);
    }
    case "enter": {
      if (!rich) return rawReplace(doc, "\n");
      const carry = styleToCarry(m, doc.sel, doc.typing);
      const from = Math.min(doc.sel.anchor, doc.sel.head);
      const to = Math.max(doc.sel.anchor, doc.sel.head);
      const s = fromEdit(enter(doc.text, from, to));
      if (isOut(s)) {
        // A carried size that is only the block's own (a saved style that names no size) is
        // the size of the block the caret is now in: the note's in a new paragraph, the
        // heading's in the second half of a heading.
        const now = lineSize(buildModel(s.text), s.sel.head, s.sel.head);
        const marks = (s.text !== doc.text ? carry : doc.typing.marks).map((c): Change => (c.kind === "size" && c.own ? { kind: "size", pt: now, own: true } : c));
        s.typing = { marks, block: null };
      }
      return s;
    }
    case "lineBreak": {
      if (!rich) return rawReplace(doc, "\n");
      const from = Math.min(doc.sel.anchor, doc.sel.head);
      const to = Math.max(doc.sel.anchor, doc.sel.head);
      return fromEdit(lineBreak(doc.text, from, to));
    }
    case "paste": {
      if (!rich) return rawReplace(doc, intent.plain);
      const from = Math.min(doc.sel.anchor, doc.sel.head);
      const to = Math.max(doc.sel.anchor, doc.sel.head);
      return fromEdit(intent.markdown ? pasteMarkdown(doc.text, from, to, intent.markdown, intent.plain) : pastePlain(doc.text, from, to, intent.plain));
    }
    case "setMark":
      return setMark(doc, intent.change, mode, m);
    case "applyStyle":
      return useStyle(doc, intent.style, mode, m);
    case "shortcut": {
      const sc = lineShortcut(doc.text, doc.sel.head);
      if (!sc) return { reason: "there is no shortcut here" };
      return fromEdit(sc);
    }
    case "setBlock":
      return setBlock(doc, intent.kind, mode);
    case "setList":
      return setList(doc, intent.kind);
    case "setLink":
      return setLink(doc, intent.href);
    case "insertBlock": {
      const r = insertBlock(doc.text, doc.sel.head, intent.what);
      if (!visibleKept(m, buildModel(r.text))) return { reason: "this cannot be inserted here" };
      return { text: r.text, sel: { anchor: r.from, head: r.to } };
    }
    case "insertPhoto": {
      if (!/^[A-Za-z0-9_-]{1,120}\.(jpg|png|webp|gif|avif)$/.test(intent.file)) return { reason: "this is not a photo name" };
      return fromEdit(insertBlocks(doc.text, doc.sel.head, `![](note.assets/${intent.file})`));
    }
    case "setImageWidth": {
      const v = intent.value;
      if (!Number.isInteger(v) || v < 5 || v > 100) return { reason: "a width is a whole percentage from 5 to 100" };
      const r = setImageWidth(doc.text, intent.at, `${v}%`);
      if (!r.ok) return { reason: r.reason };
      return { text: r.text, sel: mapSel(doc.sel, doc.text, r.text) };
    }
    case "toggleTask": {
      const r = toggleTask(doc.text, intent.at);
      if (!r.ok) return { reason: r.reason };
      return { text: r.text, sel: mapSel(doc.sel, doc.text, r.text) };
    }
    case "tableEdit":
      return tableEdit(doc, m, intent.at, intent.op, intent.pending);
    case "lineAfterTable":
      return lineAfterTable(doc, m);
    case "setMeta": {
      let value = intent.value;
      if (intent.key === "title") {
        const t = typeof value === "string" ? cleanTitle(value) : "";
        value = t === "" ? null : t;
      } else if (intent.key === "tags") {
        const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
        // A tag written by hand with other characters is kept as written and can be removed;
        // a new one is cleaned.
        const old = new Set((m.note.frontMatter?.fields.tags ?? []) as string[]);
        const out: string[] = [];
        for (const t of list) {
          const v = old.has(t) ? t : cleanTag(t);
          if (v !== "" && !out.includes(v)) out.push(v);
        }
        value = out.length ? out : null;
      } else if (typeof value === "string") {
        value = value.trim() === "" ? null : value.trim();
      }
      // The usual spacing is written as no key at all.
      if (intent.key === "spacing" && typeof value === "string" && Number(value) === 1) value = null;
      const r = writeSetting(doc.text, intent.key, value);
      if (!r.ok) return { reason: r.reason };
      // Only the front matter changes: a position at or after its end keeps its place in the
      // text after it (a caret at 0 in a note without front matter goes after the new block;
      // version 2 code review, 21); one inside it is mapped through the change.
      const oldEnd = frontMatterRegion(doc.text)[1];
      const shift = frontMatterRegion(r.text)[1] - oldEnd;
      const e = diff(doc.text, r.text);
      const at = (p: number) => (p >= oldEnd ? p + shift : Math.min(mapPos(p, e, -1), r.text.length));
      return { text: r.text, sel: { anchor: at(doc.sel.anchor), head: at(doc.sel.head) } };
    }
  }
}

/** 7.4.2: the edit lies inside the intent's region; null when it does, else the reason. */
export function checkRegion(m: Model, intent: Intent, sel: Sel, edit: TextEdit | null): string | null {
  if (!edit || inside(edit, regionOf(m, intent, sel))) return null;
  return OUTSIDE;
}

const OUTSIDE = "this change would reach outside its part of the note; make it in Raw";

/** SPEC2 7.3: the single entry point. */
export function reduce(doc: Doc, intent: Intent, mode: Mode): Result {
  const m = buildModel(doc.text);
  let s: Step;
  try {
    s = step(doc, intent, mode, m);
  } catch (e) {
    return fail(`this could not be done here (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!isOut(s)) return fail(s.reason);
  // 7.4.2: the edit lies inside the intent's region; bytes outside it are identical.
  let edit: TextEdit | null = null;
  if (s.text !== doc.text) {
    const [lo, hi] = regionOf(m, intent, doc.sel);
    edit = editWithin(doc.text, s.text, lo, hi);
    if (!edit) return fail(OUTSIDE);
  }
  const len = s.text.length;
  const sel = { anchor: clamp(s.sel.anchor, len), head: clamp(s.sel.head, len) };
  // 7.4.3: any change to the text clears `typing`, unless the intent says what it becomes.
  const typing = mode === "raw" ? NO_TYPING : (s.typing ?? (edit ? NO_TYPING : doc.typing));
  const model = buildModel(s.text);
  return { ok: true, doc: { text: s.text, sel, typing }, edit, model, ...(s.then ? { then: s.then } : {}), ...(s.skipped ? { skipped: s.skipped } : {}) };
}

function clamp(p: number, len: number): number {
  return Math.max(0, Math.min(len, p));
}

export { noteFontOf };
