#!/usr/bin/env node
// node src/cli.ts FILE.md [--page] [--css HREF] [--root DIR] [--allow-remote-images]
//
// Prints the rendered HTML fragment of a note, or with --page a complete HTML page that links
// the theme stylesheet. Local images get the real check of SPEC 6: the path is resolved
// against the note's folder, symbolic links are followed, and the file must exist inside the
// notes folder (--root, by default the note's own folder).

import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { noteBodyStyle, renderNote, type RenderResult } from "./index.ts";

const THEMES = ["paper"];
const DEFAULT_THEME = "paper";

/** SPEC 6: a local image is loaded only if the file it points to is inside the notes folder. */
export function fileSystemImageCheck(noteFile: string, root: string): (decodedPath: string) => boolean {
  let rootReal: string;
  try {
    rootReal = realpathSync(root);
  } catch {
    return () => false;
  }
  return (decodedPath) => {
    if (decodedPath === "" || isAbsolute(decodedPath)) return false;
    try {
      const target = realpathSync(resolve(dirname(noteFile), decodedPath));
      if (!statSync(target).isFile()) return false;
      const rel = relative(rootReal, target);
      return rel !== "" && !rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel);
    } catch {
      return false;
    }
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"));
}

/** The theme a note asks for, or the default theme when the name is unknown (SPEC 3). */
export function themeName(theme: string | undefined): string {
  return theme !== undefined && THEMES.includes(theme) ? theme : DEFAULT_THEME;
}

export function renderPage(result: RenderResult, cssHref: string): string {
  const style = noteBodyStyle(result.meta);
  const styleAttr = style !== "" ? ` style="${escapeHtml(style)}"` : "";
  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(result.meta.title)}</title>`,
    `<link rel="stylesheet" href="${escapeHtml(cssHref)}">`,
    "</head>",
    "<body>",
    `<article class="note"${styleAttr}>`,
    result.html + "</article>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function usage(): never {
  process.stderr.write("usage: node src/cli.ts FILE.md [--page] [--css HREF] [--root DIR] [--allow-remote-images]\n");
  process.exit(2);
}

export function main(argv: string[]): string {
  let file: string | null = null;
  let page = false;
  let css: string | null = null;
  let root: string | null = null;
  let allowRemoteImages = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--page") page = true;
    else if (a === "--allow-remote-images") allowRemoteImages = true;
    else if (a === "--css") css = argv[++i] ?? usage();
    else if (a === "--root") root = argv[++i] ?? usage();
    else if (a.startsWith("--")) usage();
    else if (file === null) file = a;
    else usage();
  }
  if (file === null) usage();
  const bytes = readFileSync(file);
  let source: string;
  try {
    // SPEC 2: a file that is not valid UTF-8 is not a note.
    source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error(`${file} is not valid UTF-8, so it is not a note`);
  }
  const result = renderNote(source, {
    fileName: basename(file),
    allowRemoteImages,
    isLocalImageAllowed: fileSystemImageCheck(file, root ?? dirname(file)),
    modifiedTime: statSync(file).mtime,
  });
  if (!page) return result.html;
  const themeFile = resolve(dirname(fileURLToPath(import.meta.url)), "..", "theme", `${themeName(result.meta.theme)}.css`);
  const href = css ?? relative(dirname(resolve(file)), themeFile).split(sep).join("/");
  return renderPage(result, href);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(main(process.argv.slice(2)));
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}
