// SPEC2 9.4: the command table. One row per control of the toolbar: its id, label, icon, key,
// the intent it sends, and how its state is read from `ToolbarState`. The toolbar, the keymap
// and the tests use it.

import type { Change, Intent, ToolbarState } from "../../../core/src/index.ts";

export type CommandId = "font" | "size" | "size-down" | "size-up" | "bold" | "italic" | "underline" | "strike" | "code" | "color" | "bg" | "link" | "list" | "insert" | "styles";

export interface Command {
  id: CommandId;
  label: string;
  icon?: string;
  /** CodeMirror key names. */
  keys?: string[];
  /** The intent a press sends, from the state shown; null for controls that open a menu or panel. */
  intent?: (st: ToolbarState) => Intent;
  /** Lit when on. */
  lit?: (st: ToolbarState) => boolean;
}

const toggle = (kind: "bold" | "italic" | "underline" | "strike" | "code") => (st: ToolbarState): Intent => ({
  type: "setMark",
  // Turns the style on if any selected character lacks it, off otherwise.
  change: { kind, on: st[kind] !== "on" } as Change,
});

export const COMMANDS: Command[] = [
  { id: "font", label: "Font" },
  { id: "size-down", label: "Smaller", keys: ["Mod-Shift-,", "Mod-Shift-<"], intent: () => ({ type: "setMark", change: { kind: "size-step", dir: -1 } }) },
  { id: "size", label: "Size" },
  { id: "size-up", label: "Larger", keys: ["Mod-Shift-.", "Mod-Shift->"], intent: () => ({ type: "setMark", change: { kind: "size-step", dir: 1 } }) },
  { id: "bold", label: "Bold", keys: ["Mod-b"], intent: toggle("bold"), lit: (st) => st.bold === "on" },
  { id: "italic", label: "Italic", keys: ["Mod-i"], intent: toggle("italic"), lit: (st) => st.italic === "on" },
  { id: "underline", label: "Underline", keys: ["Mod-u"], intent: toggle("underline"), lit: (st) => st.underline === "on" },
  { id: "strike", label: "Strikethrough", keys: ["Mod-Shift-x"], intent: toggle("strike"), lit: (st) => st.strike === "on" },
  { id: "code", label: "Inline code", icon: "code", intent: toggle("code"), lit: (st) => st.code === "on" },
  { id: "color", label: "Text colour", icon: "textcolor" },
  { id: "bg", label: "Highlight", icon: "highlight" },
  { id: "link", label: "Link", icon: "link", keys: ["Mod-k"], lit: (st) => st.link !== null },
  { id: "list", label: "List" },
  { id: "insert", label: "Insert" },
  { id: "styles", label: "Styles", icon: "styles" },
];

/** Clear formatting (Ctrl+\): not a control of its own (1.2), a key only. */
export const CLEAR: Intent = { type: "setMark", change: { kind: "clear" } };

export const LISTS: [value: string, label: string][] = [
  ["none", "No list"],
  ["bullet", "Bullets"],
  ["ordered", "Numbers"],
  ["task", "Tasks"],
];

export const INSERTS: [value: string, label: string][] = [
  ["photo", "Photo"],
  ["table", "Table"],
  ["rule", "Horizontal line"],
];

export function command(id: CommandId): Command {
  return COMMANDS.find((c) => c.id === id)!;
}
