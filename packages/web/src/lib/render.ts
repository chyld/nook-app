// SPEC2 9.6: rendering in the browser. `renderNote`'s HTML goes through DOMPurify (keeping
// `style`) before it enters the page. An image whose path is `note.assets/<file>` is loaded from
// the note's or the trash's asset route; any other image is a placeholder. Links to other sites
// open in a new tab with `rel="noopener noreferrer"`. Code is not syntax-highlighted.

import DOMPurify from "dompurify";
import { noteBodyStyle, renderNote, type NoteMeta } from "../../../../noteformat/src/index.ts";

/** The photo file if `decoded` is `note.assets/<file>` with no further folder level. */
export function photoFile(decoded: string): string | null {
  const prefix = "note.assets/";
  if (!decoded.startsWith(prefix)) return null;
  const file = decoded.slice(prefix.length);
  if (file === "" || file === "." || file === ".." || /[/\\]/.test(file)) return null;
  return file;
}

function decodeSrc(src: string): string | null {
  try {
    return src.split("/").map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
}

let purify: ReturnType<typeof DOMPurify> | null = null;

/** Renders note text into nodes; `photoUrl` gives the address of one of the note's photos. */
export function renderNodes(text: string, photoUrl: (file: string) => string): { nodes: Node[]; meta: NoteMeta; style: string } {
  purify ??= DOMPurify(window);
  const { html, meta } = renderNote(text, {
    fileName: "note.md",
    allowRemoteImages: false,
    isLocalImageAllowed: (decoded) => photoFile(decoded) !== null,
  });
  const clean = purify.sanitize(html, { ADD_ATTR: ["style", "data-src"], FORBID_TAGS: ["style", "form", "iframe", "object", "embed"] });
  // Parsed in an inert document, so that no image loads before its path is checked.
  const frag = new DOMParser().parseFromString(`<!doctype html><body>${clean}`, "text/html").body;
  for (const img of Array.from(frag.querySelectorAll("img"))) {
    const decoded = decodeSrc(img.getAttribute("src") ?? "");
    const file = decoded === null ? null : photoFile(decoded);
    if (file === null) {
      const ph = frag.ownerDocument.createElement("span");
      ph.className = "note-image-placeholder";
      ph.textContent = img.getAttribute("alt") || "Image";
      img.replaceWith(ph);
      continue;
    }
    img.setAttribute("src", photoUrl(file));
    img.setAttribute("loading", "lazy");
  }
  for (const a of Array.from(frag.querySelectorAll("a[href]"))) {
    const href = a.getAttribute("href") ?? "";
    if (/^(https?:|mailto:)/i.test(href)) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    } else a.removeAttribute("href");
  }
  return { nodes: Array.from(frag.childNodes, (n) => document.adoptNode(n)), meta, style: noteBodyStyle(meta) };
}

/** Renders into an element (an <article class="note">). */
export function renderInto(target: HTMLElement, text: string, photoUrl: (file: string) => string): NoteMeta {
  const r = renderNodes(text, photoUrl);
  target.setAttribute("style", r.style);
  target.replaceChildren(...r.nodes);
  return r.meta;
}

/** A table's Markdown drawn as the reading view draws it (for the Rich table widget). */
export function renderTableHtml(markdown: string, photoUrl: (file: string) => string): HTMLElement {
  const div = document.createElement("div");
  div.className = "note rich-table-body";
  div.append(...renderNodes(markdown, photoUrl).nodes);
  return div;
}
