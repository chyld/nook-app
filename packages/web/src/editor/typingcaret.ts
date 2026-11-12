// The caret shows the size and font waiting for the next typed text (7.4.3): with nothing
// selected, a size or font chosen in the toolbar puts an empty span of that size at the caret.
// The line grows as it will when the text is typed, and the drawn caret takes the span's height.

import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { Typing } from "../../../core/src/index.ts";
import { cssString } from "../lib/fontcss.ts";
import { editorField, intentMark } from "./field.ts";

class TypingCaret extends WidgetType {
  readonly css: string;
  constructor(css: string) {
    super();
    this.css = css;
  }
  override eq(other: TypingCaret): boolean {
    return other.css === this.css;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "rich-typing-caret";
    el.setAttribute("aria-hidden", "true");
    el.style.cssText = this.css;
    el.textContent = "\u200b";
    return el;
  }
  override coordsAt(dom: HTMLElement): { left: number; right: number; top: number; bottom: number } | null {
    const r = dom.getBoundingClientRect();
    return r.height ? { left: r.left, right: r.left, top: r.top, bottom: r.bottom } : null;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

/** The waiting size and font as CSS, or "" when neither waits. */
function waitingCss(typing: Typing): string {
  const css: string[] = [];
  for (const m of typing.marks) {
    if (m.kind === "size") css.push(`font-size: ${Math.round(m.pt * 100) / 100}pt`);
    else if (m.kind === "font" && m.value) {
      const f = m.value.toLowerCase();
      css.push(`font-family: ${f === "serif" || f === "sans" || f === "mono" ? `var(--note-font-${f})` : cssString(m.value)}`);
    }
  }
  return css.join("; ");
}

export const typingCaret = EditorView.decorations.compute([editorField, "selection"], (state) => {
  const v = state.field(editorField);
  const sel = state.selection.main;
  if (!v.rich || !sel.empty) return Decoration.none;
  const css = waitingCss(v.typing);
  if (!css) return Decoration.none;
  return Decoration.set([Decoration.widget({ widget: new TypingCaret(css), side: 1 }).range(sel.head)]);
});

/**
 * While an IME composes with a size or font waiting, the composed text is drawn in it, so it
 * does not jump when the composition ends and the text is written with it (review of alpha's
 * changes, 16). The first change of the composition clears `typing` (the caret's widget goes);
 * the size and font are taken from the state before it.
 */
export const composingStyle = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    span: { from: number; css: string } | null = null;
    update(u: ViewUpdate) {
      const compose = u.transactions.filter((tr) => tr.isUserEvent("input.type.compose") && !tr.annotation(intentMark));
      if (!u.view.composing && !compose.length) {
        this.span = null;
        this.decorations = Decoration.none;
        return;
      }
      if (this.span) this.span.from = u.changes.mapPos(this.span.from, -1);
      else if (compose.length) {
        const before = compose[0].startState;
        const css = before.field(editorField).rich ? waitingCss(before.field(editorField).typing) : "";
        if (css) this.span = { from: before.selection.main.from, css };
      }
      // CodeMirror does not wrap the node being composed in a new mark, and the composed text
      // is a bare text node of the line (it follows the caret's widget): the line carries the
      // size and font, and its other parts keep theirs (theme.ts, `.rich-composing-line`).
      const head = u.state.selection.main.head;
      const at = this.span ? u.state.doc.lineAt(this.span.from) : null;
      this.decorations = this.span && at && head > this.span.from && head <= at.to ? Decoration.set([Decoration.line({ class: "rich-composing-line", attributes: { style: this.span.css } }).range(at.from)]) : Decoration.none;
    }
  },
  { decorations: (v) => v.decorations },
);
