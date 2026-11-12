// SPEC2 10: CodeMirror's theme, in TypeScript, using only var(--…) for colours, type, spacing,
// radii and shadows. The note's own look comes from the note theme's variables.

import { EditorView } from "@codemirror/view";

export const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "var(--editor-text)", backgroundColor: "var(--surface)", color: "var(--note-ink)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6", padding: "var(--s-4) 0 var(--s-8)", scrollbarWidth: "none" },
  ".cm-scroller::-webkit-scrollbar": { display: "none" },
  ".cm-content": { caretColor: "var(--accent)", padding: "0 var(--s-5)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionLayer .cm-selectionBackground": { backgroundColor: "var(--selection)" },
  ".cm-content ::selection": { backgroundColor: "var(--selection)" },

  // Rich mode: the note as it reads.
  "&.cm-rich .cm-scroller": { fontFamily: "var(--note-font-serif)", lineHeight: "1.55" },
  "&.cm-rich .cm-line": { padding: "var(--s-0) 0" },
  ".rich-h": { fontFamily: "var(--note-font-serif)", fontWeight: "700", lineHeight: "1.25", paddingTop: "var(--s-3)" },
  // The gap between paragraphs: the note's `spacing` (1 when it has none) times the usual gap.
  ".rich-gap": { lineHeight: "calc(0.9 * var(--note-gap, 1))" },
  ".rich-code": { fontFamily: "var(--note-font-mono)", backgroundColor: "var(--note-code-bg)", padding: "0 var(--s-3)" },
  ".rich-quote": { borderLeft: "3px solid var(--note-quote-bar)", paddingLeft: "var(--s-3)", color: "var(--note-ink-soft)" },
  ".rich-q2": { paddingLeft: "var(--s-5)" },
  ".rich-q3": { paddingLeft: "var(--s-6)" },
  ".rich-li": { paddingLeft: "var(--s-5)", textIndent: "calc(-1 * var(--s-4))" },
  ".rich-d2": { paddingLeft: "var(--s-7)" },
  ".rich-d3, .rich-d4, .rich-d5, .rich-d6": { paddingLeft: "var(--s-8)" },
  ".rich-marker": { display: "inline-block", minWidth: "var(--s-4)", marginRight: "var(--s-1)", color: "var(--accent)", textIndent: "0" },
  ".rich-marker-task": {
    width: "1em",
    height: "1em",
    minWidth: "0",
    verticalAlign: "-0.15em",
    border: "2px solid var(--accent)",
    borderRadius: "var(--r-sm)",
    cursor: "pointer",
    marginRight: "var(--s-2)",
  },
  ".rich-marker-done": { backgroundColor: "var(--accent)" },
  ".rich-rule": { display: "block", height: "1px", margin: "var(--s-3) 0", backgroundColor: "var(--note-rule)" },
  ".rich-run[data-link]": { textDecoration: "underline", cursor: "pointer" },
  ".rich-photo": { position: "relative", display: "inline-block", maxWidth: "100%", verticalAlign: "bottom" },
  ".rich-photo img": { display: "block", width: "100%", height: "auto", borderRadius: "var(--r-sm)" },
  ".rich-photo:not(.has-width) img": { width: "auto", maxWidth: "100%" },
  // A photo under the pointer (or being resized) gets an outline and its handles: bars on the
  // left, right and bottom sides, dots on the two lower corners. Always shown on touch screens.
  ".rich-photo:hover, .rich-photo.is-resizing": { outline: "2px solid var(--accent)", outlineOffset: "1px", borderRadius: "var(--r-sm)" },
  ".rich-photo-handle": {
    position: "absolute",
    boxSizing: "border-box",
    borderRadius: "var(--r-pill)",
    backgroundColor: "var(--accent)",
    border: "2px solid var(--surface)",
    boxShadow: "var(--shadow-1)",
    touchAction: "none",
    opacity: "0",
    // A handle that is not shown takes no clicks: a click beside or under the photo places the
    // caret (review of alpha's changes, 10).
    pointerEvents: "none",
    transition: "opacity 0.12s ease",
  },
  ".rich-photo:hover .rich-photo-handle, .rich-photo.is-resizing .rich-photo-handle": { opacity: "1", pointerEvents: "auto" },
  // The width slider (the corner handle) reached by the keyboard is shown, with the focus ring.
  ".rich-photo-handle:focus-visible": { opacity: "1", outline: "2px solid var(--focus)", outlineOffset: "2px" },
  ".rich-photo-handle-se, .rich-photo-handle-sw": { width: "var(--s-4)", height: "var(--s-4)", bottom: "calc(-1 * var(--s-2))" },
  ".rich-photo-handle-se": { right: "calc(-1 * var(--s-2))", cursor: "nwse-resize" },
  ".rich-photo-handle-sw": { left: "calc(-1 * var(--s-2))", cursor: "nesw-resize" },
  ".rich-photo-handle-e, .rich-photo-handle-w": { width: "var(--s-3)", height: "var(--s-6)", maxHeight: "60%", top: "50%", transform: "translateY(-50%)", cursor: "ew-resize" },
  ".rich-photo-handle-e": { right: "calc(-1 * var(--s-2))" },
  ".rich-photo-handle-w": { left: "calc(-1 * var(--s-2))" },
  ".rich-photo-handle-s": { width: "var(--s-6)", maxWidth: "60%", height: "var(--s-3)", left: "50%", bottom: "calc(-1 * var(--s-2))", transform: "translateX(-50%)", cursor: "ns-resize" },
  // On a touch screen the handles are always shown, inside the photo's edges, so the strip
  // around the photo still scrolls and places the caret.
  "@media (hover: none)": {
    ".rich-photo-handle": { opacity: "1", pointerEvents: "auto" },
    ".rich-photo-handle-se, .rich-photo-handle-e": { right: "0" },
    ".rich-photo-handle-sw, .rich-photo-handle-w": { left: "0" },
    ".rich-photo-handle-se, .rich-photo-handle-sw, .rich-photo-handle-s": { bottom: "0" },
  },
  ".rich-photo-size": { position: "absolute", top: "var(--s-1)", left: "var(--s-1)", fontFamily: "var(--font-ui)", fontSize: "var(--text-xs)", color: "var(--accent-ink)", backgroundColor: "var(--accent)", borderRadius: "var(--r-sm)", padding: "0 var(--s-1)" },
  ".rich-photo-size:empty": { display: "none" },
  ".rich-image-placeholder": { display: "inline-block", padding: "var(--s-2) var(--s-3)", border: "1px dashed var(--note-rule)", color: "var(--note-ink-soft)", fontFamily: "var(--font-ui)", fontSize: "var(--text-sm)" },
  // A table sits at the left, as wide as its cells need. (The note theme draws a table as a
  // block, which lets the heading row and the body take different widths; here it is a table.)
  ".rich-table": { margin: "var(--s-2) 0", fontFamily: "var(--note-font-serif)", textAlign: "left" },
  // Its text is the note's size, as the paragraphs beside it are (the note theme's body size is
  // for a note of the usual size).
  ".rich-table .rich-table-body": { maxWidth: "none", margin: "0", padding: "0", fontSize: "var(--note-text-size, var(--note-body-size))" },
  ".rich-table table": { display: "table", borderCollapse: "collapse", width: "auto", maxWidth: "100%", margin: "0", textAlign: "left" },
  ".rich-table th, .rich-table td": { border: "1px solid var(--note-rule)", padding: "var(--s-1) var(--s-2)", minWidth: "4rem", verticalAlign: "top" },
  ".rich-table th": { backgroundColor: "var(--note-table-stripe)" },
  ".rich-cell:focus": { outline: "2px solid var(--accent)", outlineOffset: "-2px" },
  ".rich-table-tools": { display: "flex", flexWrap: "wrap", gap: "var(--s-1)", marginTop: "var(--s-1)" },
  ".rich-table-btn": {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-xs)",
    padding: "var(--s-0) var(--s-2)",
    border: "1px solid var(--rule)",
    borderRadius: "var(--r-sm)",
    backgroundColor: "var(--surface)",
    color: "var(--ink-soft)",
    cursor: "pointer",
  },
  ".rich-table-raw": { fontFamily: "var(--note-font-mono)", backgroundColor: "var(--note-code-bg)" },
  // Invisible characters, when shown: a dot over a space, an arrow over a tab, a pilcrow at a line's end.
  ".inv-space, .inv-nbsp, .inv-tab": { position: "relative" },
  ".inv-space::before, .inv-nbsp::before, .inv-tab::before": { position: "absolute", left: "50%", top: "0", transform: "translate(-50%, -0.28em)", color: "var(--accent)", opacity: "0.75", pointerEvents: "none", fontFamily: "var(--font-ui)", fontWeight: "700", fontStyle: "normal", textDecoration: "none", whiteSpace: "pre", lineHeight: "inherit" },
  ".inv-space::before": { content: '"·"' },
  // A kept space (U+00A0) has its own mark, so it can be told from a space.
  ".inv-nbsp::before": { content: '"°"' },
  ".inv-tab::before": { content: '"→"', left: "0", transform: "none" },
  ".inv-eol": { color: "var(--accent)", opacity: "0.7", pointerEvents: "none", userSelect: "none", fontFamily: "var(--font-ui)", fontSize: "0.85em", fontWeight: "400", fontStyle: "normal", paddingLeft: "var(--s-0)" },
  // While an IME composes with a size or font waiting, the line has them (typingcaret.ts) for
  // the text being composed, a bare text node; everything else on the line keeps its own.
  ".rich-composing-line > *:not([style*='font-size'])": { fontSize: "var(--editor-text)" },
  ".rich-composing-line > *:not([style*='font-family'])": { fontFamily: "var(--note-font-serif)" },
  ".cm-placeholder": { color: "var(--note-ink-soft)" },
});
