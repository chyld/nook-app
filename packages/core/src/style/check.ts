// EDITOR-PLAN 5.1: the check every command's candidate edit must pass.
//
// It compares the visible characters (styleRuns) of the old and the new text:
//   1. the same visible characters, in the same blocks, with the same hard breaks, links,
//      images and code;
//   2. outside the selection, every character's style unchanged;
//   3. inside the selection, only the requested property changed, and every selected character
//      now has the requested value;
//   4. the result follows the spec: it is what the parser reads, so a span inside a span or an
//      attribute list that is not one shows up as changed visible text (check 1);
//   5. the edit is local: text outside the touched blocks is byte for byte the same, and inside
//      them attribute lists keep their other attributes, text and order.
//
// Bold and italic on a whitespace character are not compared: they do not show, and moving a
// space outside emphasis delimiters is sometimes the only way to split emphasis (EDITOR-ISSUES).

import { styleKey, type Block, type Inline, type RunStyle, type VisibleChar } from "../../../../noteformat/src/index.ts";
import { buildModel, type Model } from "./model.ts";

export interface Expect {
  /** Visible characters (indices into the old text's chars) the command applies to. */
  selected: Set<number>;
  /** The style a selected character must have afterwards, from its old style. */
  style: (old: RunStyle, i: number) => RunStyle;
  /** The attribute key the command changes (for check 5), if any. */
  key?: string;
  /** Blocks touched by the edit (indices of old blocks); defaults to the selected chars' blocks. */
  blocks?: number[];
  /** What each old block must be afterwards; defaults to unchanged. */
  block?: (b: { kind: string; path: string; level?: number }, i: number) => { kind: string; path: string; level?: number };
}

const WS = /^\s$/u;

function keyOf(c: VisibleChar, style: RunStyle): string {
  if (WS.test(c.ch)) return styleKey({ ...style, bold: false, italic: false });
  return styleKey(style);
}

function same(a: VisibleChar, b: VisibleChar, selected: boolean): boolean {
  if (a.ch !== b.ch || a.kind !== b.kind) return false;
  // Links and code may change only where asked (the style comparison then decides).
  if (!selected && (a.style.link !== b.style.link || a.style.code !== b.style.code)) return false;
  if (a.kind === "image") {
    const x = a.image!;
    const y = b.image!;
    if (x.destination !== y.destination || x.alt !== y.alt || x.width !== y.width) return false;
  }
  return true;
}

/** Checks a candidate; returns null when it passes, or the first failed check. */
export function check(old: Model, newText: string, e: Expect): string | null {
  if (newText === old.text) return "nothing changed";
  const nm = buildModel(newText);
  const nr = nm.runs;
  const oc = old.chars;
  const nc = nr.chars;
  // 1. The same visible characters, blocks, breaks, links, images and code.
  if (oc.length !== nc.length) return "the visible text would change";
  if (old.runs.blocks.length !== nr.blocks.length) return "the blocks would change";
  for (let i = 0; i < old.runs.blocks.length; i++) {
    const ob = old.runs.blocks[i];
    const want = e.block ? e.block({ kind: ob.kind, path: ob.path, level: ob.level }, i) : { kind: ob.kind, path: ob.path, level: ob.level };
    const nb = nr.blocks[i];
    if (nb.kind !== want.kind || nb.path !== want.path || (nb.level ?? 0) !== (want.level ?? 0)) return "the blocks would change";
  }
  for (let i = 0; i < oc.length; i++) {
    if (!same(oc[i], nc[i], e.selected.has(i)) || oc[i].block !== nc[i].block) return "the visible text would change";
  }
  // 2 and 3. Styles outside and inside the selection.
  for (let i = 0; i < oc.length; i++) {
    const want = e.selected.has(i) ? e.style(oc[i].style, i) : oc[i].style;
    if (keyOf(oc[i], want) !== keyOf(nc[i], nc[i].style)) {
      return e.selected.has(i) ? "the requested style would not take effect" : "text outside the selection would change";
    }
  }
  // 4 and 5. Locality and the attribute lists.
  const touched = e.blocks ?? [...new Set([...e.selected].map((i) => oc[i].block))];
  return local(old, newText, touched, e.key);
}

/** The source range of the touched blocks, block attribute lines included. */
export function touchedRange(old: Model, touched: number[]): [number, number] {
  let r0 = Infinity;
  let r1 = -Infinity;
  for (const bi of touched) {
    const b = old.blocks[bi];
    const info = b.info;
    r0 = Math.min(r0, info.range.start);
    r1 = Math.max(r1, info.range.end);
    const pb = b.block as (Block & { attributes?: { range: { start: number; end: number } } }) | null;
    if (pb && "attributes" in pb && pb.attributes) r1 = Math.max(r1, pb.attributes.range.end);
  }
  return [r0, r1];
}

function local(old: Model, newText: string, touched: number[], key?: string): string | null {
  if (touched.length === 0) return "nothing is selected";
  const [r0, r1] = touchedRange(old, touched);
  const ot = old.text;
  if (newText.slice(0, r0) !== ot.slice(0, r0)) return "text before the selected blocks would change";
  const tail = ot.length - r1;
  if (newText.slice(newText.length - tail) !== ot.slice(r1)) return "text after the selected blocks would change";
  // Attribute lists in the region: other attributes keep their text and order.
  const oldLists = attributeLists(old.note.children, ot, r0, r1, key);
  const newLists = attributeLists(buildModel(newText).note.children, newText, r0, newText.length - tail, key);
  const oldSet = new Set(oldLists.filter((l) => l.norm !== "").map((l) => l.norm));
  const newSet = new Set(newLists.filter((l) => l.norm !== "").map((l) => l.norm));
  // A `++` or `==` mark written as a span (EDITOR-PLAN 5.3) gives these lists.
  for (const n of newSet) if (!oldSet.has(n) && n !== "underline=yes" && n !== "bg=highlight") return "an attribute list would be rewritten";
  for (const o of oldSet) if (!newSet.has(o)) return "an attribute list would be lost";
  return null;
}

interface ListInfo {
  norm: string;
}

/** The attribute lists (spans and block lines) inside [r0, r1). */
function attributeLists(blocks: readonly Block[], text: string, r0: number, r1: number, key?: string): ListInfo[] {
  const out: ListInfo[] = [];
  const addList = (attrs: { key: string; value: string; range: { start: number; end: number } }[], range: { start: number; end: number }) => {
    if (range.start < r0 || range.end > r1) return;
    const parts = attrs.filter((a) => a.key !== key).map((a) => text.slice(a.range.start, a.range.end));
    out.push({ norm: parts.join(" ") });
  };
  const inl = (nodes: readonly Inline[]) => {
    for (const n of nodes) {
      if (n.type === "span") addList(n.attributes.attributes, n.attributes.range);
      if ("children" in n && n.type !== "image") inl(n.children);
    }
  };
  const walk = (bs: readonly Block[]) => {
    for (const b of bs) {
      if (b.type === "paragraph" || b.type === "heading") {
        if (b.attributes) addList(b.attributes.list.attributes, b.attributes.list.range);
        inl(b.children);
      } else if (b.type === "blockQuote") walk(b.children);
      else if (b.type === "list") for (const it of b.children) walk(it.children);
      else if (b.type === "table") for (const row of [b.head, ...b.body]) for (const c of row.cells) inl(c.children);
    }
  };
  walk(blocks);
  return out;
}
