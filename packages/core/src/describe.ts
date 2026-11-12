// SPEC2 7.3: the toolbar's state for the selection or the caret (version 1's `selectionState`
// and `refresh` in toolbar.ts), with on, off and mixed (new), and `describeCell` for the text
// of a table cell (version 1's `styleCell` in richtable.ts).

import type { VisibleChar } from "../../../noteformat/src/index.ts";
import { blockStyleAt } from "./style/blocks.ts";
import { cellChars } from "./style/cells.ts";
import type { Model } from "./style/model.ts";
import { noteSizeOf } from "./meta.ts";
import { caretChar, listAt } from "./reduce.ts";
import type { BlockKind, Doc, ToolbarState, Tri, Val } from "./types.ts";

/** The command ids of the toolbar (9.4, section 11). */
export const COMMANDS = ["font", "size", "size-down", "size-up", "bold", "italic", "underline", "strike", "code", "color", "bg", "link", "block", "list", "insert", "styles"] as const;
export type CommandId = (typeof COMMANDS)[number];

type Ch = Pick<VisibleChar, "style" | "block">;

function tri(chars: Ch[], f: (c: Ch) => boolean): Tri {
  if (chars.length === 0) return "off";
  const n = chars.filter(f).length;
  return n === chars.length ? "on" : n === 0 ? "off" : "mixed";
}

function val<T>(chars: Ch[], f: (c: Ch) => T | null): Val<T> {
  const set = new Set(chars.map((c) => f(c) ?? null));
  if (set.size === 0) return { mixed: false, value: null };
  if (set.size > 1) return { mixed: true };
  return { mixed: false, value: [...set][0] as T | null };
}

function state(chars: Ch[], codeBlock: (c: Ch) => boolean): Omit<ToolbarState, "block" | "list" | "caret" | "can"> {
  return {
    bold: tri(chars, (c) => c.style.bold),
    italic: tri(chars, (c) => c.style.italic),
    underline: tri(chars, (c) => c.style.underline),
    strike: tri(chars, (c) => c.style.strike),
    code: tri(chars, (c) => c.style.code),
    color: val(chars, (c) => c.style.color ?? null),
    bg: val(chars, (c) => c.style.bg ?? null),
    font: val(chars, (c) => c.style.font ?? null),
    size: val(chars, (c) => Math.round(c.style.size * 10) / 10),
    link: (() => {
      const s = new Set(chars.map((c) => c.style.link));
      return s.size === 1 ? ([...s][0] ?? null) : null;
    })(),
    inCode: chars.length > 0 && chars.every(codeBlock),
  };
}

function can(st: { inCode: boolean; caret: boolean; link: string | null }, cell = false): Record<string, boolean> {
  const inline = !st.inCode;
  const out: Record<string, boolean> = {};
  for (const id of COMMANDS) out[id] = inline;
  out.link = inline && (!st.caret || st.link !== null);
  out.block = !cell;
  out.list = !cell;
  out.insert = !cell;
  out.styles = inline;
  return out;
}

/** The toolbar's state for a document (the caret's style overlaid with `typing`). */
export function describe(doc: Doc, model: Model): ToolbarState {
  const from = Math.min(doc.sel.anchor, doc.sel.head);
  const to = Math.max(doc.sel.anchor, doc.sel.head);
  const isCaret = from === to;
  const m = model;
  let chars: Ch[] = m.chars.filter((c) => c.start >= from && c.end <= to);
  if (isCaret) {
    const pick = caretChar(m, from);
    chars = pick ? [pick] : [];
  }
  const codeBlock = (c: Ch) => m.runs.blocks[c.block].kind === "code";
  const st = state(chars, codeBlock);
  if (isCaret && chars.length === 0) st.size = { mixed: false, value: noteSizeOf(m) };
  if (isCaret) {
    // What is typed next: the waiting marks win over the text at the caret.
    for (const c of doc.typing.marks) {
      switch (c.kind) {
        case "bold":
        case "italic":
        case "strike":
        case "underline":
          st[c.kind] = c.on ? "on" : "off";
          break;
        case "code":
          st.code = c.on ? "on" : "off";
          break;
        case "color":
        case "bg":
        case "font":
          st[c.kind] = { mixed: false, value: c.value };
          break;
        case "size":
          st.size = { mixed: false, value: c.pt };
          break;
        case "clear":
          st.bold = st.italic = st.strike = st.underline = "off";
          st.color = st.bg = st.font = { mixed: false, value: null };
          break;
        default:
          break;
      }
    }
  }
  const bk = blockStyleAt(m.text, from, to) as BlockKind | null;
  const block: BlockKind | null = doc.typing.block ?? bk ?? (isCaret ? "paragraph" : null);
  const list = listAt(m.text, from, to);
  return { ...st, block, list, caret: isCaret, can: can({ inCode: st.inCode, caret: isCaret, link: st.link }) };
}

/** The toolbar's state while a table cell has the focus: `from` and `to` count the cell's
 *  visible characters; with nothing selected, the whole cell (7.7). */
export function describeCell(cellSource: string, from: number, to: number): ToolbarState {
  const all = cellChars(cellSource) ?? [];
  let a = Math.max(0, Math.min(from, to));
  let b = Math.min(all.length, Math.max(from, to));
  if (a >= b) {
    a = 0;
    b = all.length;
  }
  const chars = all.slice(a, b);
  const st = state(chars, () => false);
  if (chars.length === 0) st.size = { mixed: false, value: null };
  const caret = from === to;
  return { ...st, block: null, list: "none", caret, can: can({ inCode: false, caret: false, link: st.link }, true) };
}
