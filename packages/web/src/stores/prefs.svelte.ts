// SPEC2 9.2: kept in the browser only: the sidebar folded, the last mode, invisible characters shown.

import type { Mode } from "../../../core/src/index.ts";

const KEY = "notes:prefs";

function read(): { folded: boolean; mode: Mode; invisibles: boolean } {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "{}") as { folded?: unknown; mode?: unknown; invisibles?: unknown };
    return { folded: v.folded === true, mode: v.mode === "raw" ? "raw" : "rich", invisibles: v.invisibles === true };
  } catch {
    return { folded: false, mode: "rich", invisibles: false };
  }
}

const state = $state(read());
/** Under 640 pixels, over a note: whether the sidebar's sheet is open (not kept). */
const sheet = $state({ open: false });

function write(): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(state));
  } catch {
    /* a preference that cannot be kept is not worth a warning */
  }
}

export const prefs = {
  get folded(): boolean {
    return state.folded;
  },
  get mode(): Mode {
    return state.mode;
  },
  setFolded(v: boolean): void {
    state.folded = v;
    write();
  },
  get sheet(): boolean {
    return sheet.open;
  },
  setSheet(v: boolean): void {
    sheet.open = v;
  },
  /** Spaces, tabs and line ends are drawn in the editor. */
  get invisibles(): boolean {
    return state.invisibles;
  },
  setInvisibles(v: boolean): void {
    state.invisibles = v;
    write();
  },
  setMode(m: Mode): void {
    state.mode = m;
    write();
  },
};
