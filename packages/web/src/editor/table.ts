// SPEC2 7.7: a table in Rich mode, edited in place. Clicking a cell makes that cell an editable
// region; the browser edits its text there. The cell is written to the note as one intent when it
// is left (blur, Tab, Shift+Tab, Enter), and only if its content differs from what it held when it
// was entered. Escape discards. Styles, row and column buttons, Tab and Enter carry the focused
// cell's content as `pending`, so the cell and the operation are one edit and one undo step.

import type { EditorView } from "@codemirror/view";
import { cellChars, cellMarkdown, parseTable, PLAIN, type CellRun, type CellStyle, type Change, type PendingCell, type SavedStyle, type TableOp } from "../../../core/src/index.ts";
import { dispatchIntent, notify } from "./dispatch.ts";
import { editorField, richOptions } from "./field.ts";

/** `all`: the cell is entered with its whole text selected (Tab and Enter), so typing replaces it. */
type Target = { row: number; col: number; sel?: [number, number]; all?: boolean };

/** The cell to focus once a changed table has been drawn again. */
let focusNext: (Target & { at: number }) | null = null;

/** The cell being edited, for the toolbar and `describeCell`. */
export interface ActiveCell {
  /** The cell's Markdown now (its pending content). */
  source(): string;
  /** The selection in the cell, as visible characters (code points). */
  selection(): [number, number];
  /** False for a cell edited as its Markdown text: the toolbar's styles do not apply. */
  rich: boolean;
  style(change: Change): void;
  /** A saved style, or the reset, on the selection in the cell or on the whole cell (SPEC-CELLS). */
  applyStyle(style: SavedStyle | "reset"): void;
  /** Leaves the cell, writing what was typed in it. */
  leave(): void;
  /** Writes what was typed in the cell if it changed; the cell keeps the focus otherwise. */
  flush(): void;
  /** False once the table it belongs to is no longer drawn. */
  connected(): boolean;
  /** Whether the document's selection is in this cell. */
  hasSelection(): boolean;
}

let active: ActiveCell | null = null;
const listeners = new Set<() => void>();

export function activeCell(): ActiveCell | null {
  // A table that is no longer drawn (Raw mode, "Edit as text", a redraw) has no focused cell.
  if (active && !active.connected()) active = null;
  return active;
}

export function onCellChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

function setActive(c: ActiveCell | null): void {
  active = c;
  for (const f of listeners) f();
}

// The toolbar's state in a cell follows the selection in it (review, 24).
if (typeof document !== "undefined") {
  document.addEventListener("selectionchange", () => {
    if (!active || !active.connected() || !active.hasSelection()) return;
    for (const f of listeners) f();
  });
}

function colourOf(v: string): string | undefined {
  const named = /^var\(--note-([a-z]+)\)$/.exec(v.trim());
  if (named) return named[1] === "highlight" ? "highlight" : named[1];
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)\s*(?:[,/]\s*1(?:\.0+)?\s*)?\)$/.exec(v.trim());
  if (rgb) return "#" + [rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
  if (/^#[0-9a-f]{6}$/i.test(v.trim())) return v.trim().toLowerCase();
  return undefined;
}

function fontOf(v: string): string {
  const generic = /^var\(--note-font-([a-z]+)\)$/.exec(v.trim());
  if (generic) return generic[1];
  return v.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
}

/** What a cell shows, as runs of text with their styles; null when it holds something else. */
function domRuns(root: HTMLElement, measure: boolean): CellRun[] | null {
  const out: CellRun[] = [];
  let bad = false;
  const basePt = measure ? parseFloat(getComputedStyle(root).fontSize) * 0.75 : 0;
  const walk = (node: Node, st: CellStyle, sized: boolean) => {
    for (const n of Array.from(node.childNodes)) {
      if (n.nodeType === Node.TEXT_NODE) {
        const text = n.textContent ?? "";
        if (text === "") continue;
        let size: number | null = null;
        if (sized && measure && n.parentElement) {
          const pt = Math.round(parseFloat(getComputedStyle(n.parentElement).fontSize) * 7.5) / 10;
          if (Math.abs(pt - basePt) >= 0.06) size = pt;
        }
        out.push({ text, style: { ...st, size } });
        continue;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      const el = n as HTMLElement;
      const tag = el.tagName;
      if (tag === "BR") continue;
      const next = { ...st };
      let nextSized = sized;
      if (tag === "STRONG" || tag === "B") next.bold = true;
      else if (tag === "EM" || tag === "I") next.italic = true;
      else if (tag === "DEL" || tag === "S" || tag === "STRIKE") next.strike = true;
      else if (tag === "U" || tag === "INS") next.underline = true;
      else if (tag === "CODE") next.code = true;
      else if (tag === "MARK") next.bg = "highlight";
      else if (tag === "A") next.link = el.getAttribute("href") || null;
      else if (tag !== "SPAN" && tag !== "FONT") {
        bad = true;
        return;
      }
      if (el.classList.contains("note-image-placeholder")) {
        bad = true;
        return;
      }
      const s = el.style;
      if (s.color) {
        const c = colourOf(s.color);
        if (c === undefined) bad = true;
        else next.color = c;
      }
      if (s.backgroundColor) {
        const c = colourOf(s.backgroundColor);
        if (c === undefined) bad = true;
        else next.bg = c;
      }
      if (s.fontFamily) next.font = fontOf(s.fontFamily);
      if (s.fontSize) nextSized = true;
      const line = `${s.textDecorationLine} ${s.textDecoration}`;
      if (line.includes("underline")) next.underline = true;
      if (line.includes("line-through")) next.strike = true;
      if (s.fontWeight === "bold" || Number(s.fontWeight) >= 600) next.bold = true;
      if (s.fontStyle === "italic") next.italic = true;
      if (bad) return;
      walk(el, next, nextSized);
      if (bad) return;
    }
  };
  walk(root, { ...PLAIN }, false);
  return bad ? null : out;
}

/** UTF-16 offsets of what an element shows, from code point offsets, and back. */
function toCodePoints(s: string, utf16: number): number {
  return [...s.slice(0, utf16)].length;
}
function toUtf16(s: string, cps: number): number {
  return [...s].slice(0, cps).join("").length;
}

function selectAll(el: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function selectIn(el: HTMLElement, from: number, to: number): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  let seen = 0;
  let started = false;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = (n.textContent ?? "").length;
    if (!started && from <= seen + len) {
      range.setStart(n, Math.max(0, from - seen));
      started = true;
    }
    if (started && to <= seen + len) {
      range.setEnd(n, Math.max(0, to - seen));
      break;
    }
    seen += len;
  }
  const sel = getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function caretToEnd(el: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** After a table is drawn again, the cell asked for gets the focus. */
function refocus(view: EditorView): void {
  const f = focusNext;
  if (!f) return;
  for (const w of view.contentDOM.querySelectorAll<HTMLElement>(".rich-table")) {
    let p = -1;
    try {
      p = view.posAtDOM(w);
    } catch {
      continue;
    }
    if (p !== f.at) continue;
    const cell = w.querySelector<HTMLElement>(`[data-testid="table-cell"][data-row="${Math.max(0, f.row)}"][data-col="${Math.max(0, f.col)}"]`);
    if (cell) {
      focusNext = null;
      cell.focus();
      if (f.sel) selectIn(cell, f.sel[0], f.sel[1]);
      else if (f.all) selectAll(cell);
    }
    return;
  }
}

/**
 * A table just inserted (change 11): its first cell gets the focus with its text selected, so
 * typing replaces "Column 1". Called right after the insert's dispatch, which draws the table at
 * once, so no key or click can come between (review of alpha's changes, 11). False when the
 * table holding the caret is not drawn as cells; the editor then keeps the focus.
 */
export function enterNewTable(view: EditorView): boolean {
  const head = view.state.selection.main.head;
  const t = view.state.field(editorField).tables.find(([a, z]) => a <= head && head <= z);
  if (t) {
    for (const w of view.contentDOM.querySelectorAll<HTMLElement>(".rich-table")) {
      let p = -1;
      try {
        p = view.posAtDOM(w);
      } catch {
        continue;
      }
      if (p !== t[0]) continue;
      const cell = w.querySelector<HTMLElement>('[data-testid="table-cell"][data-row="0"][data-col="0"]');
      if (!cell) break;
      cell.focus();
      selectAll(cell);
      return document.activeElement === cell;
    }
  }
  view.focus();
  return false;
}

/** How leaving a cell went. */
export type Left = "written" | "unchanged" | "refused" | "not-editing";

/**
 * The focused cell of a table (7.7), apart from the DOM. Whatever way a cell is left (blur to the
 * text or anything else, another cell, Save, Ctrl+S), its content is read while it is still the
 * focused cell and written as one intent if it changed. Unsaved cell text is never left behind.
 */
export class CellFocus<C, T = unknown> {
  #editing: C | null = null;
  readonly #read: (c: C) => PendingCell | undefined | null;
  readonly #write: (p: PendingCell, to: T | null) => boolean;

  /** `read` gives a cell's content if it changed since it was entered (null: it cannot be
   *  read); `write` writes it as one intent. */
  constructor(read: (c: C) => PendingCell | undefined | null, write: (p: PendingCell, to: T | null) => boolean) {
    this.#read = read;
    this.#write = write;
  }

  get editing(): C | null {
    return this.#editing;
  }

  /** The cell gets the focus; false when it already had it. */
  enter(c: C): boolean {
    if (this.#editing === c) return false;
    this.#editing = c;
    return true;
  }

  /** The focused cell's unsaved content, carried as `pending` by an operation. */
  pending(): PendingCell | undefined | null {
    return this.#editing === null ? undefined : this.#read(this.#editing);
  }

  /** Leaves `c`, writing what was typed in it. */
  leave(c: C, to: T | null = null): Left {
    if (this.#editing !== c) return "not-editing";
    const p = this.#read(c);
    this.#editing = null;
    if (p === null) return "refused";
    if (p === undefined) return "unchanged";
    return this.#write(p, to) ? "written" : "refused";
  }

  /**
   * Writes `c` if it changed, without leaving it (Save, and every way of leaving the note: the
   * page closing or reloading, Back, another screen). When nothing changed, or it cannot be read
   * or written, it stays the focused cell, so what is typed in it next is still written.
   */
  flush(c: C, to: T | null = null): Left {
    if (this.#editing !== c) return "not-editing";
    const p = this.#read(c);
    if (p === null) return "refused";
    if (p === undefined) return "unchanged";
    this.#editing = null;
    if (this.#write(p, to)) return "written";
    this.#editing = c;
    return "refused";
  }

  /**
   * Tab or Enter to another cell: `c` is written if it changed, and left. When the write is
   * refused (or the cell cannot be read), it stays the focused cell and the focus stays in it,
   * so what was typed is still tracked and can be fixed or discarded with Escape (review of
   * alpha's changes, 2).
   */
  move(c: C, to: T | null = null): Left {
    if (this.#editing !== c) return "not-editing";
    const r = this.flush(c, to);
    if (r === "unchanged") this.#editing = null;
    return r;
  }

  /** Escape: the cell is left and what was typed in it is discarded. */
  discard(c: C): void {
    if (this.#editing === c) this.#editing = null;
  }
}

/** Writes the focused cell, if it changed, before its text is read for a save, a draft or the
 *  "unsaved changes" check (Save, Ctrl+S, closing or reloading the page, Back, another screen). */
export function flushActiveCell(): void {
  activeCell()?.flush();
}

/** Leaves the focused cell, writing it: the table is about to stop being drawn as cells (the
 *  switch to Raw, "Edit as text"). */
export function leaveActiveCell(): void {
  activeCell()?.leave();
}

/** Makes the cells of a drawn table editable; false when it is not a plain pipe table. */
export function mountTable(view: EditorView, wrap: HTMLElement, src: string): boolean {
  const grid = parseTable(src);
  const table = wrap.querySelector("table");
  if (!grid || !table) return false;
  const trs = [...table.querySelectorAll("tr")];
  const cols = grid.align.length;
  if (trs.length !== grid.rows.length || trs.some((tr) => tr.children.length !== cols)) return false;

  interface Cell {
    el: HTMLElement;
    row: number;
    col: number;
    source: string;
    rich: boolean;
    initial: string;
    /** Makes the cell the focused one again, when a write left the table drawn as it was. */
    reenter?: () => void;
  }
  const cells: Cell[][] = trs.map((tr, row) =>
    [...tr.children].map((el, col) => {
      const e = el as HTMLElement;
      e.dataset.testid = "table-cell";
      e.dataset.row = String(row);
      e.dataset.col = String(col);
      return { el: e, row, col, source: grid.rows[row][col], rich: domRuns(e, false) !== null, initial: "" };
    }),
  );
  let last: { row: number; col: number } | null = null;
  let gone = false;
  const at = () => view.posAtDOM(wrap);

  /** A cell's content as `pending`, if it changed since it was entered. */
  const read = (c: Cell): PendingCell | undefined | null => {
    if (!c.rich) {
      const md = (c.el.textContent ?? "").replace(/ /g, " ").trim();
      return md === c.source ? undefined : { row: c.row, col: c.col, markdown: md };
    }
    const runs = domRuns(c.el, true);
    if (!runs) return null;
    if (JSON.stringify(runs) === c.initial) return undefined;
    return { row: c.row, col: c.col, runs };
  };
  const send = (op: TableOp, pending: PendingCell | undefined, to: Target | null): boolean => {
    const where = at();
    const was = active;
    focusNext = to ? { at: where, ...to } : null;
    gone = true;
    setActive(null);
    const ok = dispatchIntent(view, { type: "tableEdit", at: where, op, ...(pending ? { pending } : {}) });
    if (!ok) {
      gone = false;
      focusNext = null;
      // Refused: the table is as it was, and a cell that had the focus still has it.
      if (was && was.connected() && !active) setActive(was);
      return false;
    }
    if (wrap.isConnected) {
      // Nothing in the table changed (a space added at a cell's end, which a cell does not
      // keep), so it was not drawn again: these cells are still the live ones.
      gone = false;
      for (const c of cells.flat()) if (c.el === document.activeElement) c.reenter?.();
      // The cell that was being styled is still the one the toolbar works on (the same style
      // picked twice changes nothing; the next pick must still reach the cell).
      if (was && was.connected() && !active) setActive(was);
    }
    refocus(view);
    return true;
  };
  /** The cell being left is written as one intent, one undo step. */
  const focus = new CellFocus<Cell, Target>(read, (p, to) =>
    "runs" in p ? send({ op: "setCell", row: p.row, col: p.col, runs: p.runs }, undefined, to) : send({ op: "setCellSource", row: p.row, col: p.col, markdown: p.markdown }, undefined, to),
  );
  /** The focused cell's content, for an operation that carries it. */
  const pendingOf = (c: Cell): PendingCell | undefined | null => (c === focus.editing ? read(c) : undefined);

  const goTo = (c: Cell, row: number, col: number) => {
    const r = focus.move(c, { row, col, all: true });
    // Written: the table is drawn again and the cell asked for gets the focus. Refused: the
    // focus stays in this cell, with what was typed (the refusal is shown).
    if (r === "written" || r === "refused") return;
    const next = cells[row]?.[col]?.el;
    if (!next) return;
    next.focus();
    selectAll(next);
  };

  let clicked: { row: number; col: number } | null = null;
  table.addEventListener(
    "mousedown",
    (e) => {
      const el = (e.target as HTMLElement | null)?.closest?.("th, td");
      const c = el ? cells.flat().find((x) => x.el === el) : undefined;
      clicked = c ? { row: c.row, col: c.col } : null;
      setTimeout(() => (clicked = null), 0);
    },
    true,
  );

  for (const c of cells.flat()) {
    const el = c.el;
    el.contentEditable = "true";
    el.spellcheck = true;
    el.classList.add("rich-cell");
    let kept: [number, number] = [0, 0];
    /** The selection in the cell as visible characters (code points), not counting spaces at
     *  the cell's start. */
    const selection = (): [number, number] => {
      const sel = getSelection();
      if (!sel || !sel.rangeCount || !el.contains(sel.anchorNode) || !el.contains(sel.focusNode)) return kept;
      const range = sel.getRangeAt(0);
      const before = document.createRange();
      before.selectNodeContents(el);
      before.setEnd(range.startContainer, range.startOffset);
      const shown = (el.textContent ?? "").replace(/ /g, " ");
      const lead = shown.length - shown.trimStart().length;
      const a = Math.max(0, before.toString().length - lead);
      const b = Math.max(a, a + range.toString().length);
      const trimmed = shown.slice(lead);
      return (kept = [toCodePoints(trimmed, a), toCodePoints(trimmed, b)]);
    };
    /** A style operation on the selection in the cell, or on the whole cell with only the caret
     *  there. The selection is put back afterwards, a caret as a caret (so that what is typed next
     *  is added to the cell's text, not put in its place). */
    const styled = (op: (from: number, to: number) => TableOp): void => {
      if (gone || focus.editing !== c) return;
      if (!c.rich) {
        notify("This cell is edited as Markdown: type the marks, or use Edit as text.");
        return;
      }
      const [from, to] = selection();
      const p = pendingOf(c);
      if (p === null) return;
      // As UTF-16 offsets of the cell's own text, the spaces kept at its start counted (the
      // selection was read without them).
      const shown = (el.textContent ?? "").replace(/\u00a0/g, " ");
      const lead = shown.length - shown.trimStart().length;
      const text = shown.slice(lead);
      const back: [number, number] = [lead + toUtf16(text, from), lead + toUtf16(text, to)];
      send(op(from, to), p, { row: c.row, col: c.col, sel: back });
    };
    const handle: ActiveCell = {
      rich: c.rich,
      source: () => {
        const p = pendingOf(c);
        if (!p) return c.source;
        if ("markdown" in p) return p.markdown;
        const md = cellMarkdown(p.runs);
        return md.ok ? md.text : c.source;
      },
      selection,
      style(change: Change) {
        styled((from, to) => ({ op: "styleCell", row: c.row, col: c.col, from, to, change }));
      },
      applyStyle(style: SavedStyle | "reset") {
        styled((from, to) => ({ op: "applyStyleCell", row: c.row, col: c.col, from, to, style }));
      },
      leave: () => leave(),
      flush: () => {
        if (gone) return;
        const r = focus.flush(c);
        if (r === "written" && active === handle && focus.editing !== c) setActive(null);
      },
      connected: () => wrap.isConnected,
      hasSelection: () => {
        const sel = getSelection();
        return !!sel && sel.rangeCount > 0 && el.contains(sel.anchorNode) && el.contains(sel.focusNode);
      },
    };
    /** Leaves the cell (blur, another cell, Save): what was typed is written. */
    function leave(): void {
      if (gone || focus.editing !== c) return;
      const r = focus.leave(c, clicked);
      // Written, but the table was not drawn again and the cell still has the focus.
      if (focus.editing === c) return;
      if (active === handle) setActive(null);
      el.classList.remove("is-editing");
      if (r === "refused" || (r === "unchanged" && !c.rich)) restore(c);
    }
    el.addEventListener("focus", () => {
      setActive(handle);
      if (!focus.enter(c)) return;
      last = { row: c.row, col: c.col };
      el.classList.add("is-editing");
      if (c.rich) c.initial = JSON.stringify(domRuns(el, true));
      else el.replaceChildren(document.createTextNode(c.source));
      caretToEnd(el);
    });
    c.reenter = () => {
      if (!focus.enter(c)) return;
      setActive(handle);
      last = { row: c.row, col: c.col };
      el.classList.add("is-editing");
      // What the cell shows is now what the note holds for it.
      if (c.rich) c.initial = JSON.stringify(domRuns(el, true));
    };
    el.addEventListener("blur", (e) => {
      if (gone || focus.editing !== c) return;
      selection();
      // To the toolbar: the cell stays as it is until a style is chosen there or the focus goes
      // somewhere else.
      const to = e.relatedTarget as Element | null;
      if (to?.closest?.("[data-toolbar]")) {
        const onFocus = (f: FocusEvent) => {
          const t = f.target as Element | null;
          if (t === el || t?.closest?.("[data-toolbar]")) return;
          document.removeEventListener("focusin", onFocus, true);
          leave();
        };
        document.addEventListener("focusin", onFocus, true);
        return;
      }
      leave();
    });
    el.addEventListener("keydown", (e) => {
      // A key that confirms or edits an IME composition belongs to the composition (review, 23).
      if (e.isComposing || e.keyCode === 229) {
        e.stopPropagation();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (e.key === "Tab") {
        e.preventDefault();
        let row = c.row;
        let col = c.col + (e.shiftKey ? -1 : 1);
        if (col >= cols) (col = 0), row++;
        if (col < 0) (col = cols - 1), row--;
        if (row >= 0) {
          if (row >= cells.length) {
            const p = pendingOf(c);
            if (p !== null) send({ op: "addRow", after: cells.length - 1 }, p, { row, col });
          } else goTo(c, row, col);
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (c.row + 1 >= cells.length) {
          const p = pendingOf(c);
          if (p !== null) send({ op: "addRow", after: cells.length - 1 }, p, { row: c.row + 1, col: c.col });
        } else goTo(c, c.row + 1, c.col);
      } else if (mod && key === "a") {
        e.preventDefault();
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      } else if (mod && !e.shiftKey && !e.altKey && (key === "b" || key === "i" || key === "u")) {
        e.preventDefault();
        const kind = key === "b" ? "bold" : key === "i" ? "italic" : "underline";
        const chars = cellChars(handle.source()) ?? [];
        const [a, b] = selection();
        const part = a === b ? chars : chars.slice(a, b);
        const on = !(part.length > 0 && part.every((ch) => ch.style[kind]));
        handle.style({ kind, on } as Change);
      } else if (mod && key === "s") {
        // Save: the cell is written first, then the note is saved.
        e.preventDefault();
        e.stopPropagation();
        handle.flush();
        view.state.facet(richOptions).onSave?.();
        return;
      } else if (e.key === "Escape") {
        e.preventDefault();
        // Escape leaves the cell and discards what was typed in it.
        focus.discard(c);
        if (active === handle) setActive(null);
        c.el.classList.remove("is-editing");
        restore(c);
        view.focus();
      }
      e.stopPropagation();
    });
    el.addEventListener("paste", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const text = (e.clipboardData?.getData("text/plain") ?? "").replace(/\s*[\r\n]+\s*/g, " ");
      // As typed text, so the browser's own undo in the cell takes it back (review, 25).
      if (document.execCommand("insertText", false, text)) return;
      const sel = getSelection();
      if (!sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
    });
    for (const type of ["input", "beforeinput", "cut", "copy", "keypress", "keyup", "drop", "compositionstart", "compositionend"]) el.addEventListener(type, (e) => e.stopPropagation());
  }

  /** Escape: the cell shows what it held. */
  const original = new Map(cells.flat().map((c) => [c, Array.from(c.el.childNodes, (n) => n.cloneNode(true))]));
  const restore = (c: Cell) => c.el.replaceChildren(...(original.get(c) ?? []).map((n) => n.cloneNode(true)));

  const tool = (label: string, testid: string, run: (row: number, col: number) => { op: TableOp; to: Target }) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rich-table-btn";
    b.dataset.testid = testid;
    b.textContent = label;
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => {
      const row = last?.row ?? cells.length - 1;
      const col = last?.col ?? cols - 1;
      const p = focus.pending();
      if (p === null) return;
      const r = run(row, col);
      send(r.op, p ?? undefined, r.to);
    });
    return b;
  };
  const tools = document.createElement("div");
  tools.className = "rich-table-tools";
  tools.setAttribute("role", "group");
  tools.setAttribute("aria-label", "Table");
  tools.append(
    tool("+ Row", "table-add-row", (row, col) => ({ op: { op: "addRow", after: row }, to: { row: Math.max(1, row + 1), col } })),
    tool("+ Column", "table-add-column", (row, col) => ({ op: { op: "addColumn", after: col }, to: { row, col: col + 1 } })),
    tool("− Row", "table-remove-row", (row, col) => ({ op: { op: "removeRow", row }, to: { row: Math.max(1, Math.min(row, cells.length - 2)), col } })),
    tool("− Column", "table-remove-column", (row, col) => ({ op: { op: "removeColumn", col }, to: { row, col: Math.max(0, Math.min(col, cols - 2)) } })),
  );
  wrap.append(tools);
  setTimeout(() => {
    if (wrap.isConnected) refocus(view);
  }, 0);
  return true;
}
