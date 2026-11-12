// SPEC2 10: a note's own colours, not the app's. The twelve text colours and twelve highlights of
// the toolbar, copied from version 1's `PALETTE` and `HIGHLIGHTS` (app/web/src/toolbar.ts).

/** The twelve highlight colours: light highlighter-pen shades, written as hex values. */
export const HIGHLIGHTS: [name: string, hex: string][] = [
  ["yellow", "#fff176"],
  ["amber", "#ffd68a"],
  ["peach", "#ffc09f"],
  ["rose", "#ffb3b3"],
  ["pink", "#ffb8de"],
  ["purple", "#e3c2ff"],
  ["lavender", "#c9ceff"],
  ["blue", "#b3dcff"],
  ["aqua", "#a8ecf0"],
  ["mint", "#b2f0d0"],
  ["green", "#c5f09a"],
  ["silver", "#dcdce0"],
];

/** The twelve text colours: the format's named colours that read well as text, in both themes. */
export const PALETTE = ["red", "orange", "yellow", "green", "teal", "blue", "indigo", "purple", "pink", "brown", "gray", "black"];

/** The CSS of a note colour: a hex value as it is, a name as the note theme's variable. */
export function noteColour(v: string): string {
  return v.startsWith("#") ? v : v === "highlight" ? "var(--note-highlight)" : `var(--note-${v})`;
}

/** A highlight colour for a dark text on it (the swatches and the style previews). */
export const ON_HIGHLIGHT = "#1a1a1a";
