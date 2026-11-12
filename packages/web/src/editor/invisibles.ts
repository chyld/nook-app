// "Show invisible characters": a dot for each space, a small circle for each kept space
// (U+00A0, SPEC-NOTES "The kept space"), an arrow for each tab and a pilcrow at each line end,
// in both modes. They are drawn only (marks and widgets); the text is not changed.
//
// Review of alpha's changes, 8 and 15: the marks are CodeMirror's MatchDecorator, which keeps
// them in order and, after an edit, looks again only at the lines that changed. The line ends
// are one widget per line end in the visible ranges, each line once (two visible ranges can
// fall in one line when a long widget splits it), in order; they are mapped through an edit
// and built again only when a line end was added or removed, or the viewport moved. The last
// line has no line end, so it has no pilcrow.

import { RangeSetBuilder, type Extension, type Text } from "@codemirror/state";
import { Decoration, MatchDecorator, ViewPlugin, WidgetType, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";

class Eol extends WidgetType {
  override eq(): boolean {
    return true;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "inv-eol";
    el.setAttribute("aria-hidden", "true");
    el.textContent = "¶";
    return el;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

const space = Decoration.mark({ class: "inv-space" });
const kept = Decoration.mark({ class: "inv-nbsp" });
const tab = Decoration.mark({ class: "inv-tab" });
const eol = Decoration.widget({ widget: new Eol(), side: 1 });

const marks = new MatchDecorator({
  regexp: /[ \t\u00a0]/g,
  decoration: (m) => (m[0] === "\t" ? tab : m[0] === " " ? space : kept),
});

/** The pilcrows of the line ends in `ranges` (each line once, in order). */
export function lineEnds(doc: Text, ranges: readonly { from: number; to: number }[]): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  let last = -1;
  for (const { from, to } of ranges) {
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos);
      if (line.number < doc.lines && line.to >= from && line.to <= to && line.to > last) {
        b.add(line.to, line.to, eol);
        last = line.to;
      }
      pos = line.to + 1;
    }
  }
  return b.finish();
}

/** The parts of a view the plugin reads (a stub stands in for it in the tests). */
export type ViewLike = Pick<EditorView, "state" | "visibleRanges" | "viewport">;

/** The plugin's state: the marks and the line ends. */
export class Invisibles {
  marks: DecorationSet;
  ends: DecorationSet;
  decorations: DecorationSet;
  constructor(view: ViewLike) {
    this.marks = marks.createDeco(view as EditorView);
    this.ends = lineEnds(view.state.doc, view.visibleRanges);
    this.decorations = this.marks.update({ add: rangesOf(this.ends) });
  }
  update(u: Pick<ViewUpdate, "docChanged" | "viewportChanged" | "viewportMoved" | "changes" | "startState" | "state"> & { view: ViewLike }): void {
    if (!u.docChanged && !u.viewportChanged) return;
    this.marks = marks.updateDeco(u as ViewUpdate, this.marks);
    let lines = u.viewportChanged;
    u.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      if (inserted.lines > 1 || u.startState.doc.sliceString(fromA, toA).includes("\n")) lines = true;
    });
    this.ends = lines ? lineEnds(u.state.doc, u.view.visibleRanges) : this.ends.map(u.changes);
    this.decorations = this.marks.update({ add: rangesOf(this.ends) });
  }
}

function rangesOf(set: DecorationSet) {
  const out: ReturnType<Decoration["range"]>[] = [];
  for (let c = set.iter(); c.value; c.next()) out.push(c.value.range(c.from, c.to));
  return out;
}

export function invisibles(): Extension {
  return ViewPlugin.fromClass(
    class extends Invisibles {
      constructor(view: EditorView) {
        super(view);
      }
    },
    { decorations: (v) => v.decorations },
  );
}
