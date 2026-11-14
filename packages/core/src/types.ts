// The shapes of the editing core (SPEC2 7.3).

import type { Change } from "./style/apply.ts";
import type { CellRun } from "./style/cells.ts";
import type { Model } from "./style/model.ts";
import type { SettingKey, SettingValue } from "./fmwriter.ts";

export type { Change, CellRun, Model, SettingKey, SettingValue };

export type Mode = "rich" | "raw";
/** The routines' names, plus "none". */
export type ListKind = "none" | "bullet" | "ordered" | "task";

export interface Sel {
  anchor: number;
  head: number;
}

export interface Typing {
  /** What the next typed text gets. */
  marks: Change[];
}

export interface Doc {
  /** The Markdown, with LF line endings. */
  text: string;
  sel: Sel;
  typing: Typing;
}

export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

/** Version 1's skipped count and reasons (apply.ts). */
export interface Skipped {
  count: number;
  reasons: string[];
}

export type Result =
  | { ok: true; doc: Doc; edit: TextEdit | null; model: Model; then?: Intent; skipped?: Skipped }
  | { ok: false; reason: string };

/** A saved style (section 6). */
export interface SavedStyle {
  name: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  size: number | null;
  font: string | null;
  color: string | null;
  bg: string | null;
}

export type TableOp =
  | { op: "setCell"; row: number; col: number; runs: CellRun[] }
  | { op: "setCellSource"; row: number; col: number; markdown: string }
  | { op: "styleCell"; row: number; col: number; from: number; to: number; change: Change }
  /** A saved style, or the reset, on a cell's text: all its settings as one change (SPEC-CELLS). */
  | { op: "applyStyleCell"; row: number; col: number; from: number; to: number; style: SavedStyle | "reset" }
  | { op: "addRow"; after: number }
  | { op: "removeRow"; row: number }
  | { op: "addColumn"; after: number }
  | { op: "removeColumn"; col: number };

/** A focused cell's unsaved content, written in the same edit as the operation (7.7). */
export type PendingCell = { row: number; col: number; runs: CellRun[] } | { row: number; col: number; markdown: string };

export type Intent =
  | { type: "insertText"; text: string }
  | { type: "deleteBackward" }
  | { type: "deleteForward" }
  | { type: "deleteWordBackward" }
  | { type: "deleteWordForward" }
  | { type: "cut" }
  | { type: "enter" }
  | { type: "lineBreak" }
  | { type: "paste"; plain: string; markdown?: string | null }
  | { type: "setMark"; change: Change }
  | { type: "applyStyle"; style: SavedStyle | "reset" }
  | { type: "shortcut" }
  | { type: "setList"; kind: ListKind }
  | { type: "setLink"; href: string | null }
  | { type: "insertBlock"; what: "table" | "rule" }
  | { type: "insertPhoto"; file: string }
  | { type: "setImageWidth"; at: number; value: number }
  | { type: "toggleTask"; at: number }
  /** A place to type under a table that ends the note: a blank line, the caret on it (change 12). */
  | { type: "lineAfterTable" }
  | { type: "tableEdit"; at: number; op: TableOp; pending?: PendingCell }
  | { type: "setMeta"; key: SettingKey; value: SettingValue };

export type IntentType = Intent["type"];

export type Tri = "on" | "off" | "mixed";
/** A value, none (null), or a mixed selection. */
export type Val<T> = { mixed: false; value: T | null } | { mixed: true };

export interface ToolbarState {
  bold: Tri;
  italic: Tri;
  underline: Tri;
  strike: Tri;
  code: Tri;
  color: Val<string>;
  bg: Val<string>;
  /** null: the note's own font. */
  font: Val<string>;
  /** In points; for an empty note, the note's size. */
  size: Val<number>;
  list: ListKind;
  link: string | null;
  inCode: boolean;
  /** Nothing is selected. */
  caret: boolean;
  /** Whether each command of the toolbar can apply, by command id. */
  can: Record<string, boolean>;
}
