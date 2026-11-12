// SPEC2 8: Rich mode's decorations, from the field's model only (version 1's `richDecorations`
// in rich.ts): hidden atomic ranges for markup, link reference definition lines and the front
// matter block; marks for styles; widgets for photos, checkboxes, tables and lines; joined
// display for soft line breaks.

import { RangeSet, type Range } from "@codemirror/state";
import { Decoration, WidgetType, type EditorView, type DecorationSet } from "@codemirror/view";
import type { RunStyle } from "../../../../noteformat/src/index.ts";
import { bodyStart, isBlank, type Model } from "../../../core/src/index.ts";
import { noteColour } from "../palette.ts";
import { cssString } from "../lib/fontcss.ts";

export interface RichOptions {
  /** The address of one of the note's photos, or null when the image is not one of them. */
  photoUrl: (destination: string) => string | null;
  /** Draws a table's Markdown as the reading view does (sanitised). */
  renderTable?: (markdown: string) => HTMLElement;
  /** Makes a drawn table's cells editable; false when it can only be edited as text. */
  mountTable?: (view: EditorView, wrap: HTMLElement, src: string) => boolean;
  /** A click on a task's box. */
  onTask?: (view: EditorView, el: HTMLElement) => void;
  /** Gives a photo its resize handle. */
  onPhoto?: (view: EditorView, box: HTMLElement) => void;
  /** "Edit as text" on a table. */
  onTableAsText?: (view: EditorView, wrap: HTMLElement) => void;
  /** Ctrl+S in a table cell (the cell is written first). */
  onSave?: () => void;
}

/** The CSS of a character's style, as the reading view shows it. */
export function runCss(s: RunStyle): string {
  const out: string[] = [`font-size: ${Math.round(s.size * 100) / 100}pt`];
  if (s.bold) out.push("font-weight: 700");
  if (s.italic) out.push("font-style: italic");
  const deco = [s.underline ? "underline" : "", s.strike ? "line-through" : ""].filter(Boolean);
  if (deco.length) out.push(`text-decoration: ${deco.join(" ")}`);
  if (s.color) out.push(`color: ${noteColour(s.color)}`);
  else if (s.link) out.push("color: var(--note-link)");
  if (s.bg) out.push(`background-color: ${noteColour(s.bg)}`);
  if (s.font) {
    const f = s.font.toLowerCase();
    // The name as a CSS string, escaped (review of alpha's changes, 22).
    out.push(`font-family: ${f === "serif" || f === "sans" || f === "mono" ? `var(--note-font-${f})` : cssString(s.font)}`);
  } else if (s.code) out.push("font-family: var(--note-font-mono)");
  if (s.code && !s.bg) out.push("background-color: var(--note-code-bg)");
  return out.join("; ");
}

class TextWidget extends WidgetType {
  readonly text: string;
  readonly css: string;
  readonly cls: string;
  constructor(text: string, css: string, cls = "rich-text") {
    super();
    this.text = text;
    this.css = css;
    this.cls = cls;
  }
  eq(o: TextWidget) {
    return o.text === this.text && o.css === this.css && o.cls === this.cls;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = this.cls;
    s.textContent = this.text;
    if (this.css) s.setAttribute("style", this.css);
    return s;
  }
}

class MarkerWidget extends WidgetType {
  readonly text: string;
  readonly kind: string;
  readonly opts: RichOptions;
  constructor(text: string, kind: string, opts: RichOptions) {
    super();
    this.text = text;
    this.kind = kind;
    this.opts = opts;
  }
  eq(o: MarkerWidget) {
    return o.text === this.text && o.kind === this.kind;
  }
  toDOM(view: EditorView) {
    const s = document.createElement("span");
    s.className = `rich-marker rich-marker-${this.kind.replace(" ", " rich-marker-")}`;
    s.textContent = this.text;
    if (this.kind.startsWith("task")) {
      s.setAttribute("role", "checkbox");
      s.setAttribute("aria-checked", String(this.kind === "task done"));
      s.setAttribute("aria-label", "Task done");
      s.dataset.testid = "task-box";
      s.dataset.checked = String(this.kind === "task done");
      s.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.opts.onTask?.(view, s);
      });
    } else s.setAttribute("aria-hidden", "true");
    return s;
  }
  ignoreEvent(e: Event) {
    return this.kind.startsWith("task") && e.type === "mousedown";
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "rich-rule";
    s.setAttribute("role", "separator");
    return s;
  }
}

class ImageWidget extends WidgetType {
  readonly alt: string;
  readonly src: string | null;
  readonly width: string | null;
  readonly opts: RichOptions;
  constructor(alt: string, src: string | null, width: string | null, opts: RichOptions) {
    super();
    this.alt = alt;
    this.src = src;
    this.width = width;
    this.opts = opts;
  }
  eq(o: ImageWidget) {
    return o.alt === this.alt && o.src === this.src && o.width === this.width;
  }
  toDOM(view: EditorView) {
    let el: HTMLElement;
    if (!this.src) {
      el = document.createElement("span");
      el.className = "note-image-placeholder rich-image-placeholder";
      el.textContent = this.alt || "Image";
    } else {
      const img = document.createElement("img");
      img.className = "rich-image";
      img.alt = this.alt;
      img.src = this.src;
      img.draggable = false;
      el = img;
    }
    const box = document.createElement("span");
    box.className = `rich-photo${this.width ? " has-width" : ""}`;
    box.dataset.testid = "photo";
    if (this.width) {
      box.style.width = this.width;
      box.dataset.width = this.width;
    }
    box.append(el);
    this.opts.onPhoto?.(view, box);
    return box;
  }
  ignoreEvent(e: Event) {
    return e.type.startsWith("pointer");
  }
}

class TableWidget extends WidgetType {
  readonly src: string;
  readonly opts: RichOptions;
  constructor(src: string, opts: RichOptions) {
    super();
    this.src = src;
    this.opts = opts;
  }
  eq(o: TableWidget) {
    return o.src === this.src;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "rich-table";
    wrap.dataset.testid = "table";
    if (this.opts.renderTable) wrap.append(this.opts.renderTable(this.src));
    else {
      const pre = document.createElement("pre");
      pre.textContent = this.src;
      wrap.append(pre);
    }
    const grid = this.opts.mountTable?.(view, wrap, this.src) ?? false;
    if (grid) wrap.classList.add("rich-grid");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rich-table-btn";
    btn.dataset.testid = "table-as-text";
    btn.textContent = "Edit as text";
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => this.opts.onTableAsText?.(view, wrap));
    (wrap.querySelector(".rich-table-tools") ?? wrap).append(btn);
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

const hiddenDeco = Decoration.replace({});

function lineStartOf(text: string, pos: number): number {
  let s = pos;
  while (s > 0 && text[s - 1] !== "\n") s--;
  return s;
}

function lineEndOf(text: string, pos: number): number {
  let e = pos;
  while (e < text.length && text[e] !== "\n") e++;
  return e;
}

type TNode = { type: string; range: { start: number; end: number }; children?: unknown[] };

/** Every table's lines [from, to]. */
export function tableRanges(m: Model): [number, number][] {
  const text = m.text;
  const out: [number, number][] = [];
  const walk = (bs: TNode[]) => {
    for (const b of bs) {
      if (b.type === "table") out.push([lineStartOf(text, b.range.start), lineEndOf(text, Math.max(b.range.start, b.range.end - 1))]);
      else if (b.children && (b.type === "list" || b.type === "listItem" || b.type === "blockQuote")) walk(b.children as TNode[]);
    }
  };
  walk(m.note.children as unknown as TNode[]);
  return out;
}

/** Where the body starts in a note with front matter (core's rule, which the typing routines
 *  use too): after it and the one blank line that usually follows it. */
export { bodyStart };

export interface Decorated {
  decorations: DecorationSet;
  atomic: RangeSet<Decoration>;
  rawTables: number[];
  tables: [number, number][];
}

/** The decorations of Rich mode for a model. */
export function richDecorations(m: Model, opts: RichOptions, rawTables: number[] = []): Decorated {
  const text = m.text;
  const decos: Range<Decoration>[] = [];
  const replaced: [number, number, Decoration][] = [];
  const replace = (a: number, b: number, d: Decoration = hiddenDeco) => {
    if (b > a) replaced.push([a, b, d]);
  };
  const lineClasses: [number, string][] = [];
  const lineDeco = (pos: number, cls: string) => lineClasses.push([lineStartOf(text, pos), cls]);

  // The whole front matter block, from position 0 to the start of the body.
  const fm = m.note.frontMatter;
  if (fm) replace(0, bodyStart(m));
  // Link reference definitions: whole lines, hidden.
  for (const d of m.note.definitions) {
    const a = lineStartOf(text, d.range.start);
    let b = lineEndOf(text, d.range.end);
    if (b < text.length) b++;
    replace(a, b);
  }

  const numbers = new Map<number, string>();
  const walk = (bs: readonly { type: string }[]) => {
    for (const b of bs as { type: string; ordered?: boolean; start?: number; marker?: string; children?: { type: string; range: { start: number }; children: { type: string }[] }[] }[]) {
      if (b.type === "list" && b.children) {
        b.children.forEach((item, i) => {
          if (b.ordered) numbers.set(item.range.start, `${(b.start ?? 1) + i}${b.marker ?? "."}`);
          walk(item.children);
        });
      } else if (b.type === "blockQuote" && b.children) walk(b.children as unknown as { type: string }[]);
    }
  };
  walk(m.note.children as unknown as { type: string }[]);

  const tables = tableRanges(m);
  const covered: [number, number][] = [];
  const keptRaw: number[] = [];
  for (const [a, z] of tables) {
    covered.push([a, z]);
    if (rawTables.some((p) => p >= a && p <= z)) {
      keptRaw.push(a);
      for (let p = a; p <= z; ) {
        lineDeco(p, "rich-table-raw");
        p = lineEndOf(text, p) + 1;
      }
    } else replace(a, z, Decoration.replace({ widget: new TableWidget(text.slice(a, z), opts), block: true }));
  }
  if (fm) covered.push([0, bodyStart(m)]);
  for (const d of m.note.definitions) covered.push([lineStartOf(text, d.range.start), lineEndOf(text, d.range.end)]);

  for (const blk of m.blocks) {
    const info = blk.info;
    if (info.kind === "cell") {
      covered.push([lineStartOf(text, info.range.start), lineEndOf(text, info.range.end)]);
      continue;
    }
    const start = lineStartOf(text, info.range.start);
    const pb = blk.block as { attributes?: { range: { end: number } } } | null;
    const end = Math.max(info.range.end, pb && "attributes" in pb && pb.attributes ? pb.attributes.range.end : 0);
    if (info.kind === "rule") {
      replace(start, lineEndOf(text, info.range.start), Decoration.replace({ widget: new RuleWidget() }));
      covered.push([start, lineEndOf(text, info.range.start)]);
      continue;
    }
    const keep: [number, number][] = [];
    const chars = m.chars.slice(blk.va, blk.vb);
    chars.forEach((c, k) => {
      const src = text.slice(c.start, c.end);
      if (c.kind === "soft") {
        replace(c.start, c.end, Decoration.replace({ widget: new TextWidget(" ", runCss(c.style)) }));
        keep.push([c.start, c.end]);
      } else if (c.kind === "hard") {
        const le = src.search(/\n/);
        if (le >= 0) keep.push([c.start + le, c.end]);
      } else if (c.kind === "image") {
        const img = c.image!;
        replace(c.start, c.end, Decoration.replace({ widget: new ImageWidget(img.alt, opts.photoUrl(img.destination), img.width, opts) }));
        keep.push([c.start, c.end]);
      } else if (info.kind === "code" && c.ch === "\n" && k === chars.length - 1) {
        // The line ending of a code block's last line: the closing fence's line goes with it.
      } else if (src.length > 1 && src[0] === "&") {
        replace(c.start, c.end, Decoration.replace({ widget: new TextWidget(c.ch, runCss(c.style)) }));
        keep.push([c.start, c.end]);
      } else if (src.length === 2 && src[0] === "\\") {
        keep.push([c.start + 1, c.end]);
      } else keep.push([c.start, c.end]);
    });
    keep.sort((x, y) => x[0] - y[0]);
    const item = /\/list:(bullet|ordered)\/item:(\d+)(:task(-done)?)?$/.exec(info.path);
    let markerWidget: WidgetType | null = null;
    if (item && keep.length) {
      const markerSrc = text.slice(start, keep[0][0]);
      const m1 = /^[\s>]*([-+*]|\d{1,9}[.)])/.exec(markerSrc);
      if (m1) {
        let label = "•";
        if (item[1] === "ordered") {
          label = m1[1];
          for (const [at, n] of numbers) if (at >= start && at < keep[0][0]) label = n;
        }
        if (item[3]) label = "";
        markerWidget = new MarkerWidget(label, item[3] ? (item[4] ? "task done" : "task") : item[1], opts);
      }
    }
    let pos = start;
    for (const [a, b] of keep) {
      if (a > pos) replace(pos, a, pos === start && markerWidget ? Decoration.replace({ widget: markerWidget }) : hiddenDeco);
      pos = Math.max(pos, b);
    }
    if (end > pos) {
      const le = lineEndOf(text, pos);
      let w = Math.min(le, end);
      while (w > pos && (text[w - 1] === " " || text[w - 1] === "\t")) w--;
      replace(pos, w);
      if (end > Math.min(le, end)) replace(Math.min(le, end), end);
    }
    covered.push([start, end]);

    let runStart = -1;
    let runEnd = -1;
    let runCssText = "";
    let runLink: string | null = null;
    const styleClosingMarkup = (e: number, css: string) => {
      const gap = replaced.find((r) => r[0] === e && r[2] === hiddenDeco);
      if (gap) gap[2] = Decoration.replace({ widget: new TextWidget("", css, "rich-close") });
    };
    const flush = () => {
      if (runStart >= 0 && runEnd > runStart) styleClosingMarkup(runEnd, runCssText);
      if (runStart >= 0 && runEnd > runStart) decos.push(Decoration.mark({ attributes: runLink ? { style: runCssText, "data-link": runLink } : { style: runCssText }, class: "rich-run" }).range(runStart, runEnd));
      runStart = -1;
    };
    for (const c of chars) {
      if (c.kind !== "text") {
        flush();
        continue;
      }
      const css = runCss(c.style);
      if (runStart >= 0 && css === runCssText && runLink === c.style.link) runEnd = c.end;
      else {
        flush();
        runStart = c.start;
        runEnd = c.end;
        runCssText = css;
        runLink = c.style.link;
      }
    }
    flush();

    const first = chars[0]?.start ?? info.range.start;
    if (info.kind === "heading") lineDeco(first, `rich-h rich-h${info.level}`);
    if (info.kind === "code") {
      for (let p = start; p < end; ) {
        const le = lineEndOf(text, p);
        lineDeco(p, "rich-code");
        p = le + 1;
      }
    }
    const depth = (info.path.match(/\/list:/g) ?? []).length;
    const quoted = (info.path.match(/\/quote/g) ?? []).length;
    const cls = [quoted ? `rich-quote rich-q${Math.min(quoted, 3)}` : "", depth ? `rich-li rich-d${Math.min(depth, 6)}` : ""].filter(Boolean).join(" ");
    if (cls) lineDeco(first, cls);
  }

  // Lines outside every block: an empty list item or quote line shows as its marker; a blank
  // line next to a block is a gap between blocks.
  covered.sort((a, b) => a[0] - b[0]);
  const isCovered = (a: number, z: number) => covered.some(([x, y]) => a <= y && z >= x);
  const lines: [number, number][] = [];
  for (let p = 0; p <= text.length; ) {
    const le = lineEndOf(text, p);
    lines.push([p, le]);
    if (le >= text.length) break;
    p = le + 1;
  }
  // A line holding a kept space (U+00A0) is text, not blank (SPEC-NOTES, "The kept space").
  const blankAt = (n: number) => n >= 0 && n < lines.length && isBlank(text.slice(lines[n][0], lines[n][1]));
  lines.forEach(([a, z], n) => {
    if (isCovered(a, z)) return;
    const line = text.slice(a, z);
    if (isBlank(line)) {
      if ((n > 0 && !blankAt(n - 1)) || (n + 1 < lines.length && !blankAt(n + 1))) decos.push(Decoration.line({ class: "rich-gap" }).range(a));
      return;
    }
    const em = /^((?: {0,3}>[ ]?)*)( {0,3}([-+*]|\d{1,9}[.)])(?:[ ]+\[([ xX])\])?[ ]*)?$/.exec(line);
    if (!em || (!em[1] && !em[2])) return;
    const cls = [em[1] ? "rich-quote rich-q1" : "", em[2] ? "rich-li rich-d1" : ""].filter(Boolean).join(" ");
    decos.push(Decoration.line({ class: cls }).range(a));
    const label = em[4] !== undefined ? "" : em[3] && /\d/.test(em[3]) ? em[3] : "•";
    replace(a, z, em[2] ? Decoration.replace({ widget: new MarkerWidget(label, em[4] !== undefined ? (em[4] === " " ? "task" : "task done") : "bullet", opts) }) : hiddenDeco);
  });

  replaced.sort((x, y) => x[0] - y[0] || y[1] - x[1]);
  const atomicRanges: Range<Decoration>[] = [];
  let last = -1;
  for (const [a, b, d] of replaced) {
    if (a < last) {
      if (b <= last) continue;
      decos.push(hiddenDeco.range(last, b));
      atomicRanges.push(hiddenDeco.range(last, b));
      last = b;
      continue;
    }
    decos.push(d.range(a, b));
    atomicRanges.push(d.range(a, b));
    last = b;
  }
  const hidden = atomicRanges.map((r) => [r.from, r.to] as const);
  for (const [at, cls] of lineClasses) {
    let p = at;
    for (;;) {
      const over = p > 0 ? hidden.find(([a, b]) => a <= p - 1 && b > p - 1) : undefined;
      if (!over) break;
      const q = lineStartOf(text, over[0]);
      if (q >= p) break;
      p = q;
    }
    decos.push(Decoration.line({ class: cls }).range(p));
  }
  return { decorations: Decoration.set(decos, true), atomic: RangeSet.of(atomicRanges, true), rawTables: keptRaw, tables };
}
