// styleRuns(): the visible characters of a note in order, each with its effective style, its
// block and its place in the source (EDITOR-PLAN 5.1). The editor's checks compare these.
//
// A visible character is a character of text, a soft break, a hard break, or an image (one
// unit). Each has the style it is shown with, worked out by the rules of SPEC 5.5:
// bold, italic, strikethrough, code, underline, colour, background, font, the effective size in
// points, and the link it is part of.

import { absoluteSizePt, NAMED_SIZES, resolveAttributes } from "./attributes.ts";
import { matchEntity } from "./entities.ts";
import { isAsciiPunct } from "./chars.ts";
import { parseNote } from "./parse.ts";
import { BODY_PT, HEADING_FACTORS } from "./style.ts";
import type { Block, Inline, Note, Range, ResolvedStyle } from "./types.ts";

export interface RunStyle {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  underline: boolean;
  color: string | null;
  bg: string | null;
  font: string | null;
  /** Effective size in points (px count 0.75pt; named sizes multiply). */
  size: number;
  /** Destination of the link the character is part of. */
  link: string | null;
}

export type CharKind = "text" | "soft" | "hard" | "image";

export interface VisibleChar {
  /** The character: itself; " " for a soft break; "\n" for a hard break; U+FFFC for an image. */
  ch: string;
  kind: CharKind;
  style: RunStyle;
  /** Index into `blocks`. */
  block: number;
  /** Source range of the character (for an escape or entity, the whole of it). */
  start: number;
  end: number;
  /** For an image: destination, alt text and width. */
  image?: { destination: string; alt: string; width: string | null };
}

export type BlockKind = "paragraph" | "heading" | "code" | "cell" | "rule";

export interface BlockInfo {
  kind: BlockKind;
  level?: number;
  /** Containers from the outside in, such as `quote/list:bullet:-/item:0` and the task state. */
  path: string;
  /** The size of the block in points, after its block attribute line. */
  size: number;
  range: Range;
  /** The block's own style from its block attribute line. */
  line: ResolvedStyle;
  /** True when the block may carry a block attribute line (a direct child of the document). */
  topLevel: boolean;
}

export interface StyleRunsResult {
  chars: VisibleChar[];
  blocks: BlockInfo[];
  /** The note's size in points (front matter `size`, else the theme's 12pt). */
  noteSize: number;
}

/** A value of a size attribute applied to a base size, in points. */
export function sizeIn(value: string | undefined, base: number): number {
  if (value === undefined) return base;
  const abs = absoluteSizePt(value);
  if (abs !== null) return abs;
  return base * (NAMED_SIZES[value] ?? 1);
}

/** The note's own size in points (EDITOR-PLAN 4). */
export function noteSizeOf(note: Note): number {
  const size = note.frontMatter?.fields.size;
  if (size === undefined) return BODY_PT;
  return sizeIn(size.toLowerCase() in NAMED_SIZES ? size.toLowerCase() : size, BODY_PT);
}

/** The size in points of a heading of `level` in a note of `noteSize`. */
export function headingSize(level: number, noteSize: number): number {
  return noteSize * HEADING_FACTORS[level - 1];
}

interface InlineState {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  ulMark: boolean;
  hlMark: boolean;
  span: ResolvedStyle | null;
  link: string | null;
}

/**
 * `input` is the note's source, or its parsed tree; with a tree, give its source as `text` too,
 * so that each character gets its own source range.
 */
export function styleRuns(input: Note | string, text?: string): StyleRunsResult {
  const note = typeof input === "string" ? parseNote(input) : input;
  const source = typeof input === "string" ? input : (text ?? null);
  const fm = note.frontMatter?.fields ?? {};
  const noteSize = noteSizeOf(note);
  const chars: VisibleChar[] = [];
  const blocks: BlockInfo[] = [];
  let imageWidth: string | null = null;

  const visit = (bs: readonly Block[], path: string, topLevel: boolean) => {
    for (const b of bs) {
      switch (b.type) {
        case "paragraph":
        case "heading": {
          const imageLine = b.attributes?.target === "image";
          const line = b.attributes && !imageLine ? resolveAttributes(b.attributes.list.attributes, b.type === "heading" ? "heading" : "paragraph") : {};
          imageWidth = imageLine && b.attributes ? (resolveAttributes(b.attributes.list.attributes, "image").width ?? null) : null;
          const base = b.type === "heading" ? headingSize(b.level, noteSize) : noteSize;
          const info: BlockInfo = {
            kind: b.type,
            path,
            size: sizeIn(line.size, base),
            range: b.range,
            line,
            topLevel: topLevel && (b.type === "paragraph" || !b.setext),
          };
          if (b.type === "heading") info.level = b.level;
          blocks.push(info);
          inlines(b.children, blocks.length - 1, { bold: false, italic: false, strike: false, code: false, ulMark: false, hlMark: false, span: null, link: null });
          break;
        }
        case "blockQuote":
          visit(b.children, `${path}/quote`, false);
          break;
        case "list":
          b.children.forEach((item, i) => {
            const task = item.task ? (item.task.checked ? ":task-done" : ":task") : "";
            visit(item.children, `${path}/list:${b.ordered ? "ordered" : "bullet"}/item:${i}${task}`, false);
          });
          break;
        case "codeBlock": {
          blocks.push({ kind: "code", path, size: noteSize, range: b.range, line: {}, topLevel: false });
          const bi = blocks.length - 1;
          const style: RunStyle = { ...plain(noteSize), code: true };
          // Each character's place in the source: the value is the source of the content
          // lines without their indentation, so a greedy walk finds each character.
          let pos = b.range.start;
          if (b.fenced && source !== null) {
            const nl = source.slice(pos).search(/\r\n|\n|\r/);
            pos = nl < 0 ? b.range.end : pos + nl + (source.startsWith("\r\n", pos + nl) ? 2 : 1);
          }
          for (const ch of b.value) {
            if (source === null) {
              chars.push({ ch, kind: "text", style, block: bi, start: b.range.start, end: b.range.end });
              continue;
            }
            let at = pos;
            while (at < b.range.end && !(source[at] === ch || (ch === "\n" && (source[at] === "\r" || source[at] === "\n")))) at++;
            if (at >= b.range.end) at = Math.min(pos, b.range.end);
            const len = ch === "\n" && source.startsWith("\r\n", at) ? 2 : ch.length;
            chars.push({ ch, kind: "text", style, block: bi, start: at, end: Math.min(at + len, Math.max(at, b.range.end)) });
            pos = at + len;
          }
          break;
        }
        case "thematicBreak":
          blocks.push({ kind: "rule", path, size: noteSize, range: b.range, line: {}, topLevel: false });
          break;
        case "table":
          [b.head, ...b.body].forEach((row, r) =>
            row.cells.forEach((cell, c) => {
              imageWidth = null;
              blocks.push({ kind: "cell", path: `${path}/table/r${r}/c${c}`, size: noteSize, range: cell.range, line: {}, topLevel: false });
              inlines(cell.children, blocks.length - 1, { bold: false, italic: false, strike: false, code: false, ulMark: false, hlMark: false, span: null, link: null });
            }),
          );
          break;
      }
    }
  };

  const plain = (size: number): RunStyle => ({
    bold: false,
    italic: false,
    strike: false,
    code: false,
    underline: false,
    color: null,
    bg: null,
    font: null,
    size,
    link: null,
  });

  const styleOf = (s: InlineState, block: BlockInfo): RunStyle => {
    const span = s.span ?? {};
    const line = block.line;
    let underline: boolean;
    if (s.ulMark) underline = true;
    else if (span.underline !== undefined) underline = span.underline === "yes";
    else underline = line.underline === "yes";
    return {
      bold: s.bold,
      italic: s.italic,
      strike: s.strike,
      code: s.code,
      underline,
      color: span.color?.toLowerCase() ?? line.color?.toLowerCase() ?? null,
      bg: span.bg?.toLowerCase() ?? (s.hlMark ? "highlight" : null) ?? line.bg?.toLowerCase() ?? null,
      font: span.font ?? line.font ?? (s.code ? null : (fm.font ?? null)),
      size: sizeIn(span.size, block.size),
      link: s.link,
    };
  };

  const inlines = (nodes: readonly Inline[], bi: number, s: InlineState) => {
    const block = blocks[bi];
    for (const n of nodes) {
      switch (n.type) {
        case "text":
          pushText(n.value, n.range, styleOf(s, block), bi);
          break;
        case "softBreak":
          chars.push({ ch: " ", kind: "soft", style: styleOf(s, block), block: bi, start: n.range.start, end: n.range.end });
          break;
        case "hardBreak":
          chars.push({ ch: "\n", kind: "hard", style: styleOf(s, block), block: bi, start: n.range.start, end: n.range.end });
          break;
        case "code":
          pushCode(n.value, n.range, styleOf({ ...s, code: true }, block), bi);
          break;
        case "emphasis":
          inlines(n.children, bi, { ...s, italic: true });
          break;
        case "strong":
          inlines(n.children, bi, { ...s, bold: true });
          break;
        case "strikethrough":
          inlines(n.children, bi, { ...s, strike: true });
          break;
        case "underline":
          inlines(n.children, bi, { ...s, ulMark: true });
          break;
        case "highlight":
          inlines(n.children, bi, { ...s, hlMark: true });
          break;
        case "span":
          inlines(n.children, bi, { ...s, span: resolveAttributes(n.attributes.attributes, "span") });
          break;
        case "link":
          inlines(n.children, bi, { ...s, link: n.destination });
          break;
        case "image": {
          chars.push({
            ch: "￼",
            kind: "image",
            style: styleOf(s, block),
            block: bi,
            start: n.range.start,
            end: n.range.end,
            image: { destination: n.destination, alt: n.alt, width: imageWidth },
          });
          break;
        }
      }
    }
  };

  /** A text node, character by character, with the source range of each (escapes, entities). */
  const pushText = (value: string, range: Range, style: RunStyle, bi: number) => {
    if (source !== null) {
      const src = source.slice(range.start, range.end);
      const mapped = mapText(src, value);
      if (mapped) {
        for (const m of mapped) chars.push({ ch: m.ch, kind: "text", style, block: bi, start: range.start + m.start, end: range.start + m.end });
        return;
      }
    }
    for (const ch of value) chars.push({ ch, kind: "text", style, block: bi, start: range.start, end: range.end });
  };

  const pushCode = (value: string, range: Range, style: RunStyle, bi: number) => {
    if (source !== null) {
      const src = source.slice(range.start, range.end);
      const ticks = /^`+/.exec(src)?.[0].length ?? 0;
      // CommonMark: line endings become spaces; then one space is stripped from each end when
      // both ends have one and the content is not all spaces.
      let parts: { ch: string; start: number; end: number }[] = [];
      for (let i = range.start + ticks; i < range.end - ticks; ) {
        if (source.startsWith("\r\n", i)) {
          parts.push({ ch: " ", start: i, end: i + 2 });
          i += 2;
        } else {
          const ch = String.fromCodePoint(source.codePointAt(i)!);
          parts.push({ ch: ch === "\n" || ch === "\r" ? " " : ch, start: i, end: i + ch.length });
          i += ch.length;
        }
      }
      if (parts.length >= 2 && parts[0].ch === " " && parts[parts.length - 1].ch === " " && parts.some((p) => p.ch !== " ")) {
        parts = parts.slice(1, -1);
      }
      if (parts.map((p) => p.ch).join("") === value) {
        for (const p of parts) chars.push({ ch: p.ch, kind: "text", style, block: bi, start: p.start, end: p.end });
        return;
      }
    }
    for (const ch of value) chars.push({ ch, kind: "text", style, block: bi, start: range.start, end: range.end });
  };

  visit(note.children, "", true);
  return { chars, blocks, noteSize };
}

/**
 * The characters of a text node's value with their offsets in its source: a backslash escape
 * or an entity reference is one character of the value. Null when the decoding does not give
 * exactly `value` (the caller then gives every character the whole node's range).
 */
function mapText(src: string, value: string): { ch: string; start: number; end: number }[] | null {
  const out: { ch: string; start: number; end: number }[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\" && i + 1 < src.length && isAsciiPunct(src[i + 1])) {
      out.push({ ch: src[i + 1], start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (c === "&") {
      const e = matchEntity(src, i);
      if (e) {
        const chs = Array.from(e.text);
        for (const ch of chs) out.push({ ch, start: i, end: i + e.length });
        i += e.length;
        continue;
      }
    }
    const cp = src.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    out.push({ ch, start: i, end: i + ch.length });
    i += ch.length;
  }
  return out.map((o) => o.ch).join("") === value ? out : null;
}

/** The style of a character as one comparable string. */
export function styleKey(s: RunStyle): string {
  return [
    s.bold ? "B" : "",
    s.italic ? "I" : "",
    s.strike ? "S" : "",
    s.code ? "C" : "",
    s.underline ? "U" : "",
    `c=${s.color ?? ""}`,
    `h=${s.bg ?? ""}`,
    `f=${s.font ?? ""}`,
    `z=${Math.round(s.size * 1000) / 1000}`,
    `l=${s.link ?? ""}`,
  ].join("|");
}
