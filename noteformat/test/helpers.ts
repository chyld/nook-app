import { renderNote, type RenderOptions } from "../src/index.ts";

/** The rendered HTML fragment of a note. */
export function html(source: string, options?: RenderOptions): string {
  return renderNote(source, options).html;
}

/** A paragraph as the renderer writes it. */
export function p(inner: string): string {
  return `<p>${inner}</p>\n`;
}

export function span(style: string, inner: string): string {
  return `<span style="${style}">${inner}</span>`;
}
