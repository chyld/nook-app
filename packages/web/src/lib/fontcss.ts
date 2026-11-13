// CSS text made from font names and slugs (finding 16): every value is written as a CSS string
// with its quotes, backslashes and line breaks escaped, so no name can end the string, the
// declaration or the block it is in.

/** A CSS string literal holding `v`. */
export function cssString(v: string): string {
  return `"${v.replace(/[\\"\n\r\f\u0000-\u001f\u007f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`;
}

/** The style attribute that shows a name in a family of the person's fonts, falling back to
 *  the app's own font. (The fallback is a family, never `inherit`: a keyword like that is not
 *  allowed in a list of families, and the browser then drops the whole declaration.) */
export function familyStyle(family: string): string {
  return `font-family: ${cssString(family)}, var(--font-ui)`;
}

/** The font faces of the catalogue's previews, each loaded from the app. */
export function previewFaces(families: readonly { slug: string }[], url: (slug: string) => string): string {
  return families.map((f) => `@font-face { font-family: ${cssString(`preview-${f.slug}`)}; src: url(${cssString(url(f.slug))}) format("woff2"); font-display: swap; }`).join("\n");
}
