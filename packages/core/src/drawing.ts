// SPEC-DRAWINGS 4.2 to 4.6: a drawing's file, `drawing.excalidraw`: an ordinary Excalidraw
// file (UTF-8 JSON) with one more top-level key, `nook`, holding the title, the tags and the
// date it was made. Pure: used by the server (the index, the checks of a save) and by the
// browser (the text it saves, its drafts, what counts as unsaved).

import { isIsoDateOrDateTime } from "../../../noteformat/src/frontmatter.ts";
import { TITLE_MAX } from "./meta.ts";

/** What Nook keeps beside the scene. */
export interface DrawingNook {
  title: string;
  tags: string[];
  /** `YYYY-MM-DD` (or a date-time of the note format); null when the file has none. */
  created: string | null;
}

/** A scene as Excalidraw gives it: its elements (deleted ones too), its app state, its images. */
export interface DrawingScene {
  elements: readonly unknown[];
  appState: Readonly<Record<string, unknown>>;
  files: Readonly<Record<string, unknown>>;
}

/** The only `appState` values a file keeps (4.2); the view, zoom, selection and tool are not. */
export const KEPT_APP_STATE = ["viewBackgroundColor", "gridSize", "gridStep", "gridModeEnabled"] as const;

/** The tag pattern (contract's `PATTERNS.tag`). */
const TAG = /^[a-z]{1,30}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isLive = (e: unknown): e is Record<string, unknown> => isObject(e) && e.isDeleted !== true;

/** An element with its own keys in alphabetical order (nested values as they are). */
function sortedKeys(e: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(e).sort()) out[k] = e[k];
  return out;
}

/** The kept part of an app state, in the order of `KEPT_APP_STATE`. */
export function keptAppState(appState: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of KEPT_APP_STATE) if (appState[k] !== undefined) out[k] = appState[k];
  return out;
}

/** The file ids the elements that are not deleted use, in alphabetical order. */
export function usedFileIds(elements: readonly unknown[]): string[] {
  const ids = new Set<string>();
  for (const e of elements) if (isLive(e) && typeof e.fileId === "string") ids.add(e.fileId);
  return [...ids].sort();
}

/**
 * 4.2: the file's text. The top-level keys in a fixed order; every element that is not deleted,
 * in scene order, its keys in alphabetical order; four `appState` values; in `files` only the
 * images a remaining element uses, by id in alphabetical order, each as given; two-space
 * indent, LF, a final line break. The same scene always gives the same bytes.
 */
export function serializeDrawing(scene: DrawingScene, nook: DrawingNook): string {
  const elements = scene.elements.filter(isLive).map(sortedKeys);
  const files: Record<string, unknown> = {};
  for (const id of usedFileIds(elements)) if (scene.files[id] !== undefined) files[id] = scene.files[id];
  const n: Record<string, unknown> = { title: nook.title, tags: [...nook.tags] };
  if (nook.created !== null) n.created = nook.created;
  const doc = { type: "excalidraw", version: 2, source: "nook", elements, appState: keptAppState(scene.appState), files, nook: n };
  return JSON.stringify(doc, null, 2) + "\n";
}

/** 4.2: the text a create writes. */
export function emptyDrawing(title: string, created: string): string {
  return serializeDrawing({ elements: [], appState: { viewBackgroundColor: "#ffffff" }, files: {} }, { title, tags: [], created });
}

/** Why a text is not a drawing (4.4, 4.6), or null when it is one. */
export type DrawingProblem = "not-json" | "not-excalidraw";

/** A file is a drawing when it is a JSON object with `type` "excalidraw" and an array `elements`. */
export function drawingProblem(text: string): DrawingProblem | null {
  return parseDrawing(text).problem;
}

/** A drawing's text read: its parts, or why it is not a drawing. Never throws. */
export function parseDrawing(text: string): { problem: DrawingProblem | null; doc: Record<string, unknown> | null } {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { problem: "not-json", doc: null };
  }
  if (!isObject(v)) return { problem: "not-json", doc: null };
  if (v.type !== "excalidraw" || !Array.isArray(v.elements)) return { problem: "not-excalidraw", doc: null };
  return { problem: null, doc: v };
}

/** 4.6: `nook` read value by value; anything else is passed over. */
export function nookOf(doc: Record<string, unknown> | null): DrawingNook {
  const n = doc && isObject(doc.nook) ? doc.nook : {};
  const title = typeof n.title === "string" ? [...n.title].slice(0, TITLE_MAX).join("") : "";
  const tags = Array.isArray(n.tags) ? [...new Set(n.tags.filter((t): t is string => typeof t === "string" && TAG.test(t)))] : [];
  const created = typeof n.created === "string" && isIsoDateOrDateTime(n.created) ? n.created : null;
  return { title, tags, created };
}

/** 4.6: the text for search and the excerpt: each text element's `originalText`, else `text`. */
export function drawingText(elements: readonly unknown[]): string {
  const out: string[] = [];
  for (const e of elements) {
    if (!isLive(e) || e.type !== "text") continue;
    if (typeof e.originalText === "string") out.push(e.originalText);
    else if (typeof e.text === "string") out.push(e.text);
  }
  return out.join("\n");
}

export interface DrawingFacts {
  /** "broken": not JSON, or not an Excalidraw scene (4.6). */
  broken: boolean;
  title: string;
  tags: string[];
  created: string | null;
  /** The text of its text elements, for search (never the JSON). */
  text: string;
}

/** 4.6: what the index needs of a drawing's text. Never throws. */
export function drawingFacts(text: string): DrawingFacts {
  const { problem, doc } = parseDrawing(text);
  if (problem || !doc) return { broken: true, title: "Untitled", tags: [], created: null, text: "" };
  const n = nookOf(doc);
  return { broken: false, title: n.title.trim() === "" ? "Untitled" : n.title, tags: n.tags, created: n.created, text: drawingText(doc.elements as unknown[]) };
}

/**
 * 4.3: the signature of a drawing: for each element that is not deleted, in order, its `id` and
 * `version`; the four kept `appState` values; the title; the tags. Two drawings with the same
 * signature are the same for "unsaved".
 */
export function drawingSignature(elements: readonly unknown[], appState: Readonly<Record<string, unknown>>, title: string, tags: readonly string[]): string {
  const els = elements.filter(isLive).map((e) => [e.id, e.version]);
  return JSON.stringify([els, KEPT_APP_STATE.map((k) => appState[k] ?? null), title, tags]);
}
