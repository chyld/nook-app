// SPEC-AGENTS 5.5, 5.6 and 3.3: the documents an agent's request makes. Pure: the text of a new
// note (SPEC2 4.3), the front matter the server puts before a note an agent creates, `nook`
// added to a drawing an agent creates, a note taken as head and text for an append, and the
// two comparisons that refuse a save that empties or drops an image.

import { parseNote } from "../../../noteformat/src/index.ts";
import { usedFileIds } from "./drawing.ts";

/** A YAML double-quoted string, with `\` and `"` escaped (SPEC2 4.3). */
export function yamlQuote(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

/** SPEC2 4.3: the text of a new note. */
export function newNoteText(title: string, created: string): string {
  return `---\ntitle: ${yamlQuote(title)}\ncreated: ${created}\n---\n\n`;
}

/** The first line ending of a text: `\r\n` or `\n`; `\n` when it has none. */
export function firstLineEnding(text: string): "\n" | "\r\n" {
  const at = text.indexOf("\n");
  return at > 0 && text.charCodeAt(at - 1) === 0x0d ? "\r\n" : "\n";
}

/** True when a note's text has front matter the format reads (5.5). */
export function hasFrontMatter(text: string): boolean {
  return parseNote(text).frontMatter !== null;
}

/**
 * 5.5: a note an agent creates without front matter. A byte order mark at the start of the body
 * is dropped; the front matter is a `---` line, `title` if given, `tags` if any, `created`, a
 * `---` line and an empty line, with the body's first line ending (LF when it has none).
 */
export function withFrontMatter(body: string, title: string | null, tags: readonly string[], created: string): string {
  const text = body.charCodeAt(0) === 0xfeff ? body.slice(1) : body;
  const eol = firstLineEnding(text);
  const lines = ["---"];
  if (title !== null) lines.push(`title: ${yamlQuote(title)}`);
  if (tags.length) lines.push(`tags: [${tags.join(", ")}]`);
  lines.push(`created: ${created}`, "---", "");
  return lines.join(eol) + eol + text;
}

/**
 * 5.5: a drawing an agent creates without a `nook` key: the same JSON object with `nook` as its
 * last key, a two-space indent and a final line break, its other keys and their order as sent.
 * `doc` is the parsed file.
 */
export function withNook(doc: Readonly<Record<string, unknown>>, nook: { title: string; tags: readonly string[]; created: string }): string {
  return JSON.stringify({ ...doc, nook: { title: nook.title, tags: [...nook.tags], created: nook.created } }, null, 2) + "\n";
}

/**
 * 5.6: a note in two parts. The head is a byte order mark and the front matter through the line
 * ending of its closing `---` (the format's front-matter range); or only the mark; or nothing.
 * The text is the rest.
 */
export function splitNote(note: string): { head: string; text: string } {
  const fm = parseNote(note).frontMatter;
  const end = fm ? fm.range.end : note.charCodeAt(0) === 0xfeff ? 1 : 0;
  return { head: note.slice(0, end), text: note.slice(end) };
}

/** Only spaces, tabs and line endings. A kept space (U+00A0) is content, as everywhere in the
 *  app (SPEC-NOTES, "The kept space"), so `trim()` is not used. */
const isOnlySpace = (s: string): boolean => /^[ \t\r\n]*$/.test(s);

/** True when a note has nothing but spaces, tabs and line endings after its head (3.3). */
export function noteIsBlank(note: string): boolean {
  return isOnlySpace(splitNote(note).text);
}

/**
 * 5.6: `body` added at the end of `note`, or null when the body is empty or only white space.
 * The body takes the note's first line ending (LF when the note has none) and loses a byte order
 * mark at its start and the line endings at its start and end. Spaces, tabs and line endings go
 * from the end of the note's text (no other character); the head and the rest of the text are
 * not changed. Between a text that is not empty and the body there is exactly one empty line.
 */
export function appendToNote(note: string, body: string): string | null {
  const sent = body.charCodeAt(0) === 0xfeff ? body.slice(1) : body;
  if (isOnlySpace(sent)) return null;
  const eol = firstLineEnding(note);
  const added = sent
    .replace(/\r\n?/g, "\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "")
    .replace(/\n/g, eol);
  const { head, text } = splitNote(note);
  const kept = text.replace(/[ \t\r\n]+$/, "");
  // A head that is front matter ends with its closing line's line ending, unless the file ended
  // at that line; a head that is only a byte order mark has no line of its own.
  const hasLine = head.length > 0 && head !== "﻿";
  const start = hasLine && !/\n$/.test(head) ? head + eol : head;
  return start + (kept === "" ? "" : kept + eol + eol) + added + eol;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The elements of a parsed drawing that are objects not marked deleted (`isDeleted` not true). */
export function liveElements(doc: Readonly<Record<string, unknown>>): Record<string, unknown>[] {
  const els = Array.isArray(doc.elements) ? (doc.elements as unknown[]) : [];
  return els.filter((e): e is Record<string, unknown> => isObject(e) && e.isDeleted !== true);
}

/**
 * 3.3: the first image file an agent's save of a drawing would drop: an element that is not
 * deleted names it, the new `files` does not hold it, and the current file's `files` does. Null
 * when there is none.
 */
export function droppedImage(next: Readonly<Record<string, unknown>>, current: Readonly<Record<string, unknown>>): string | null {
  const nextFiles = isObject(next.files) ? next.files : {};
  const currentFiles = isObject(current.files) ? current.files : {};
  const used = usedFileIds(Array.isArray(next.elements) ? (next.elements as unknown[]) : []);
  // Own keys only: an id such as "constructor" is not a file a plain object happens to have.
  const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;
  for (const id of used) if (!has(nextFiles, id) && has(currentFiles, id)) return id;
  return null;
}
