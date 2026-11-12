// Rendering the syntax tree as an HTML fragment, following the HTML contract of the brief, and
// the precedence rules of SPEC 5.5.

import { resolveAttributes } from "./attributes.ts";
import { escapeHtml } from "./chars.ts";
import {
  decodeLocalPath,
  defaultIsLocalImageAllowed,
  encodeLocalPath,
  hasSupportedExtension,
  isRemote,
} from "./images.ts";
import { plainText } from "./inline/index.ts";
import { cssBg, styleDeclarations } from "./style.ts";
import type { Block, Image, Inline, ListItem, Note, Paragraph, ResolvedStyle, Table } from "./types.ts";

export interface RenderOptions {
  /** The note's file name, for the title fallback (SPEC 3). */
  fileName?: string;
  /** Load remote images (SPEC 6: only after the person allows it). Default false. */
  allowRemoteImages?: boolean;
  /**
   * Decides whether a local image may be loaded, given its percent-decoded path. Default: true
   * for a relative path that does not start with "/" and does not leave its folder through "..".
   */
  isLocalImageAllowed?: (decodedPath: string) => boolean;
  /** The file's modification time, the default of `updated` (SPEC 3). */
  modifiedTime?: Date | string;
}

interface InlineContext {
  options: RenderOptions;
  /** The background of the nearest enclosing span that sets a valid `bg`, as CSS. */
  spanBg: string | null;
}

export function renderBlocks(note: Note, options: RenderOptions = {}): string {
  return blocks(note.children, options);
}

function blocks(list: readonly Block[], options: RenderOptions): string {
  return list.map((b) => block(b, options)).join("");
}

function attr(name: string, value: string): string {
  return ` ${name}="${escapeHtml(value)}"`;
}

function block(b: Block, options: RenderOptions): string {
  switch (b.type) {
    case "paragraph":
      return paragraph(b, options, "");
    case "heading": {
      const style = b.attributes ? resolveAttributes(b.attributes.list.attributes, "heading") : {};
      const { html, decls } = styledInlines(b.children, style, options, b.level);
      const tag = `h${b.level}`;
      return `<${tag}${decls.length > 0 ? attr("style", decls.join("; ")) : ""}>${html}</${tag}>\n`;
    }
    case "blockQuote":
      return `<blockquote>\n${blocks(b.children, options)}</blockquote>\n`;
    case "list": {
      const tag = b.ordered ? "ol" : "ul";
      const start = b.ordered && b.start !== 1 ? attr("start", String(b.start)) : "";
      return `<${tag}${start}>\n${b.children.map((item) => listItem(item, options)).join("")}</${tag}>\n`;
    }
    case "codeBlock": {
      const cls = b.language !== "" ? attr("class", `language-${b.language}`) : "";
      return `<pre><code${cls}>${escapeHtml(b.value)}</code></pre>\n`;
    }
    case "thematicBreak":
      return "<hr>\n";
    case "table":
      return table(b, options);
  }
}

function paragraph(p: Paragraph, options: RenderOptions, prefix: string): string {
  if (p.attributes?.target === "image" && p.children.length === 1 && p.children[0].type === "image") {
    const style = resolveAttributes(p.attributes.list.attributes, "image");
    const img = image(p.children[0], { options, spanBg: null }, style.width);
    return `<p>${prefix}${img}</p>\n`;
  }
  const style = p.attributes ? resolveAttributes(p.attributes.list.attributes, "paragraph") : {};
  const { html, decls } = styledInlines(p.children, style, options);
  if (p.tight) return prefix + html;
  return `<p${decls.length > 0 ? attr("style", decls.join("; ")) : ""}>${prefix}${html}</p>\n`;
}

const CHECKBOX = '<input type="checkbox" disabled>';
const CHECKBOX_CHECKED = '<input type="checkbox" disabled checked>';

function listItem(item: ListItem, options: RenderOptions): string {
  let out = "";
  item.children.forEach((child, k) => {
    const prefix = k === 0 && item.task ? (item.task.checked ? CHECKBOX_CHECKED : CHECKBOX) + " " : "";
    if (child.type === "paragraph" && child.tight) {
      out += paragraph(child, options, prefix);
      if (k < item.children.length - 1) out += "\n";
    } else {
      if (k === 0) out += "\n";
      out += child.type === "paragraph" ? paragraph(child, options, prefix) : block(child, options);
    }
  });
  return `<li>${out}</li>\n`;
}

function table(t: Table, options: RenderOptions): string {
  const cellAttr = (i: number) => (t.align[i] ? attr("style", `text-align: ${t.align[i]}`) : "");
  const ctx: InlineContext = { options, spanBg: null };
  let out = "<table>\n<thead>\n<tr>\n";
  t.head.cells.forEach((c, i) => {
    out += `<th${cellAttr(i)}>${inlines(c.children, ctx)}</th>\n`;
  });
  out += "</tr>\n</thead>\n";
  if (t.body.length > 0) {
    out += "<tbody>\n";
    for (const row of t.body) {
      out += "<tr>\n";
      row.cells.forEach((c, i) => {
        out += `<td${cellAttr(i)}>${inlines(c.children, ctx)}</td>\n`;
      });
      out += "</tr>\n";
    }
    out += "</tbody>\n";
  }
  return out + "</table>\n";
}

// ---------------------------------------------------------------------------------------------
// Inline content of a block with a block attribute line, and SPEC 5.5 underline precedence

function spanStyle(n: Inline & { type: "span" }): ResolvedStyle {
  return resolveAttributes(n.attributes.attributes, "span");
}

/** A span that sets `underline=no` and is not inside a `++` mark, anywhere in these nodes. */
function hasCancellingSpan(nodes: readonly Inline[]): boolean {
  for (const n of nodes) {
    if (n.type === "span") {
      if (spanStyle(n).underline === "no") return true;
    } else if (n.type === "underline") {
      continue; // inside ++ the text is underlined whatever the span says (5.5 rule 1)
    } else if (n.type !== "image" && "children" in n && hasCancellingSpan(n.children)) {
      return true;
    }
  }
  return false;
}

/**
 * Renders a heading's or paragraph's inline content together with the declarations of its
 * block attribute line. CSS cannot remove an underline that an ancestor paints, so when the
 * block sets `underline=yes` and a span inside sets `underline=no` (SPEC 5.5 rules 2 and 3),
 * the block element does not get `text-decoration: underline`; instead every piece of its
 * content outside such spans is wrapped in `<span style="text-decoration: underline">`.
 */
function styledInlines(
  nodes: readonly Inline[],
  style: ResolvedStyle,
  options: RenderOptions,
  headingLevel?: number,
): { html: string; decls: string[] } {
  const ctx: InlineContext = { options, spanBg: null };
  let decls = styleDeclarations(style, headingLevel);
  if (style.underline === "yes" && hasCancellingSpan(nodes)) {
    decls = decls.filter((d) => d !== "text-decoration: underline");
    return { html: underlineWrapped(nodes, ctx), decls };
  }
  return { html: inlines(nodes, ctx), decls };
}

const BLOCK_UNDERLINE_OPEN = '<span style="text-decoration: underline">';

function underlineWrapped(nodes: readonly Inline[], ctx: InlineContext): string {
  let out = "";
  let run: Inline[] = [];
  const flush = () => {
    if (run.length > 0) out += BLOCK_UNDERLINE_OPEN + inlines(run, ctx) + "</span>";
    run = [];
  };
  for (const n of nodes) {
    if (n.type === "span" && spanStyle(n).underline === "no") {
      flush();
      out += inline(n, ctx);
    } else if (n.type !== "span" && n.type !== "underline" && n.type !== "image" && "children" in n && hasCancellingSpan(n.children)) {
      flush();
      out += inline(n, ctx, (inner) => underlineWrapped(inner, ctx));
    } else {
      run.push(n);
    }
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------------------------
// Inline nodes

function inlines(nodes: readonly Inline[], ctx: InlineContext): string {
  return nodes.map((n) => inline(n, ctx)).join("");
}

type ChildRenderer = (children: readonly Inline[]) => string;

/** Renders one inline node; `renderChildren` replaces the normal rendering of its children. */
function inline(n: Inline, ctx: InlineContext, renderChildren?: ChildRenderer): string {
  const kids = (children: readonly Inline[], c: InlineContext = ctx) =>
    renderChildren ? renderChildren(children) : inlines(children, c);
  switch (n.type) {
    case "text":
      return escapeHtml(n.value);
    case "softBreak":
      return "\n";
    case "hardBreak":
      return "<br>\n";
    case "code":
      return `<code>${escapeHtml(n.value)}</code>`;
    case "emphasis":
      return `<em>${kids(n.children)}</em>`;
    case "strong":
      return `<strong>${kids(n.children)}</strong>`;
    case "strikethrough":
      return `<del>${kids(n.children)}</del>`;
    case "underline":
      return `<u>${kids(n.children)}</u>`;
    case "highlight": {
      // SPEC 5.5: a span's bg is stronger than a == mark even when the span encloses the mark.
      const style = ctx.spanBg !== null ? attr("style", `background-color: ${ctx.spanBg}`) : "";
      return `<mark${style}>${kids(n.children)}</mark>`;
    }
    case "span": {
      const style = spanStyle(n);
      const decls = styleDeclarations(style);
      const inner: InlineContext = { ...ctx, spanBg: style.bg !== undefined ? cssBg(style.bg) : ctx.spanBg };
      return `<span${decls.length > 0 ? attr("style", decls.join("; ")) : ""}>${kids(n.children, inner)}</span>`;
    }
    case "link": {
      const href = safeHref(n.destination);
      const title = n.title !== null ? attr("title", n.title) : "";
      return `<a${href !== null ? attr("href", href) : ""}${title}>${kids(n.children)}</a>`;
    }
    case "image":
      return image(n, ctx);
  }
}

/**
 * Percent-encodes a destination for an href or src the way the CommonMark reference renderers
 * do: characters outside the URL-safe set are UTF-8 percent-encoded, and existing `%XX` escapes
 * are kept.
 */
export function encodeUrl(url: string): string {
  let out = "";
  for (let i = 0; i < url.length; ) {
    if (url[i] === "%" && /^[0-9a-fA-F]{2}$/.test(url.slice(i + 1, i + 3))) {
      out += url.slice(i, i + 3);
      i += 3;
      continue;
    }
    const cp = url.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    if (/^[A-Za-z0-9;/?:@&=+$,\-_.!~*'()#]$/.test(ch)) out += ch;
    else if (cp >= 0xd800 && cp <= 0xdfff) out += "%EF%BF%BD";
    else out += encodeURIComponent(ch);
    i += ch.length;
  }
  return out;
}

/** Links to `javascript:`, `vbscript:`, `file:` and `data:` URLs get no href. */
function safeHref(destination: string): string | null {
  if (/^(?:javascript|vbscript|file|data):/i.test(destination.trim())) return null;
  return encodeUrl(destination);
}

/** SPEC 6: an image is shown if it may be loaded; otherwise a placeholder with alt and path. */
function image(n: Image, ctx: InlineContext, width?: string): string {
  const placeholder = () =>
    `<span class="note-image-placeholder"${attr("data-src", n.destination)}>${escapeHtml(n.alt)}</span>`;
  let src: string | null = null;
  if (isRemote(n.destination)) {
    if (ctx.options.allowRemoteImages) src = encodeUrl(n.destination);
  } else {
    const decoded = decodeLocalPath(n.destination);
    const allowed = ctx.options.isLocalImageAllowed ?? defaultIsLocalImageAllowed;
    if (decoded !== null && hasSupportedExtension(decoded) && allowed(decoded)) src = encodeLocalPath(decoded);
  }
  if (src === null) return placeholder();
  const title = n.title !== null ? attr("title", n.title) : "";
  const style = width !== undefined ? attr("style", `width: ${width}`) : "";
  return `<img${attr("src", src)}${attr("alt", n.alt)}${title}${style}>`;
}

export { plainText };
