// The public API: parseNote() and renderNote().

import { plainText } from "./inline/index.ts";
import { parseNote } from "./parse.ts";
import { renderBlocks, type RenderOptions } from "./render.ts";
import { bodyStyle } from "./style.ts";
import type { Block, Note } from "./types.ts";

export { parseNote } from "./parse.ts";
export { isValidId } from "./frontmatter.ts";
export { parseAttributeList, resolveAttributes } from "./attributes.ts";
export { bodyStyle, BODY_PT, HEADING_FACTORS } from "./style.ts";
export { styleRuns, styleKey, sizeIn, noteSizeOf, headingSize } from "./runs.ts";
export type { RunStyle, VisibleChar, BlockInfo, BlockKind, CharKind, StyleRunsResult } from "./runs.ts";
export { validSize, absoluteSizePt, NAMED_SIZES } from "./attributes.ts";
export type { RenderOptions } from "./render.ts";
export type * from "./types.ts";

/** The note's settings and metadata (SPEC 3), with the defaults applied. */
export interface NoteMeta {
  /** front matter `id` when it is valid (SPEC 3, version 1.1). */
  id?: string;
  /** front matter `title`, else the text of the first level-1 heading, else the file name. */
  title: string;
  tags: string[];
  created?: string;
  /** front matter `updated`, else the file's modification time when it was given. */
  updated?: string;
  font?: string;
  size?: string;
  theme?: string;
}

export interface RenderResult {
  /** The rendered body, an HTML fragment. */
  html: string;
  meta: NoteMeta;
}

export function renderNote(source: string, options: RenderOptions = {}): RenderResult {
  const note = parseNote(source);
  return { html: renderBlocks(note, options), meta: noteMeta(note, options) };
}

function firstHeadingText(blocks: readonly Block[]): string | null {
  for (const b of blocks) {
    if (b.type === "heading" && b.level === 1) {
      const text = plainText(b.children).trim();
      if (text !== "") return text;
    } else if (b.type === "blockQuote") {
      const t = firstHeadingText(b.children);
      if (t !== null) return t;
    } else if (b.type === "list") {
      for (const item of b.children) {
        const t = firstHeadingText(item.children);
        if (t !== null) return t;
      }
    }
  }
  return null;
}

/** The file name without its folder and without the `.md` extension. */
function noteName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  return base.replace(/\.md$/i, "");
}

export function noteMeta(note: Note, options: RenderOptions = {}): NoteMeta {
  const f = note.frontMatter?.fields ?? {};
  const title = f.title ?? firstHeadingText(note.children) ?? (options.fileName ? noteName(options.fileName) : "");
  const meta: NoteMeta = { title, tags: f.tags ?? [] };
  if (f.id !== undefined) meta.id = f.id;
  if (f.created !== undefined) meta.created = f.created;
  const mtime = options.modifiedTime;
  if (f.updated !== undefined) meta.updated = f.updated;
  else if (mtime !== undefined) meta.updated = typeof mtime === "string" ? mtime : mtime.toISOString();
  if (f.font !== undefined) meta.font = f.font;
  if (f.size !== undefined) meta.size = f.size;
  if (f.theme !== undefined) meta.theme = f.theme;
  return meta;
}

/** The inline style for the element that holds the rendered body (front matter font, size). */
export function noteBodyStyle(meta: NoteMeta): string {
  return bodyStyle(meta);
}
