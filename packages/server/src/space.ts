// SPEC2 section 4: storage. A note is a folder named by its id; its file is always `note.md`
// and its photos are in `note.assets/`. A drawing (SPEC-DRAWINGS 4) is a folder of the same tree
// and id space whose file is `drawing.excalidraw`, its images inside it; the main file decides
// the kind, and every operation below works by kind. Every request that reads the index or changes a file of
// a user goes through `Spaces.run(userId, fn)`, which holds that user's lock (4.1, rule 2). The
// methods of `UserSpace` assume the lock is held; nothing else calls them.

import { constants } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { KIND_LIMITS, MB, makeVersion, newNoteId, randomBase32, RE, type Entry, type HistoryEntry, type Kind, type TrashEntry } from "../../contract/src/index.ts";
import { cleanTitle, decodeUtf8, drawingFacts, drawingProblem, emptyDrawing, hasBrokenFrontMatter, noteTitle, parseDrawing, plainSpaces, usedFileIds } from "../../core/src/index.ts";
import { parseNote } from "../../../noteformat/src/index.ts";
import { HttpError } from "./errors.ts";
import { createFile, emptyDir, ensureDir, errCode, fsyncDir, isNotFound, readRegular, replaceFile, revisionOf, step } from "./fsutil.ts";
import { DataLayout, EXT, MAIN_FILE, UserLayout } from "./layout.ts";
import { Mutex } from "./lock.ts";
import type { Logger } from "./log.ts";
import { lstatOrNull, readdirOrEmpty, sfs as fs } from "./safefs.ts";

interface Indexed {
  id: string;
  kind: Kind;
  title: string;
  tags: string[];
  created: string | null;
  mtimeNs: bigint;
  size: number;
  /** Null when the file is not valid UTF-8. A note's text; a drawing's is the text of its text
   *  elements (SPEC-DRAWINGS 4.6), never its bytes. */
  text: string | null;
  broken: boolean;
}

export interface NoteDoc {
  text: string;
  revision: string;
  entry: Entry;
}

const notFound = () => new HttpError(404, "There is no such note.");
const trashed = () => new HttpError(410, "This note is in the trash.");

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** A YAML double-quoted string, with `\` and `"` escaped (4.3). */
export function yamlQuote(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

/** 4.3: the text of a new note. */
export function newNoteText(title: string, created: string): string {
  return `---\ntitle: ${yamlQuote(title)}\ncreated: ${created}\n---\n\n`;
}

/** The facts of a note's text for the index (4.2, 4.5). */
function facts(text: string | null): Pick<Indexed, "title" | "tags" | "created" | "broken"> {
  if (text === null) return { title: "Cannot be opened", tags: [], created: null, broken: false };
  const broken = hasBrokenFrontMatter(text);
  const f = parseNote(text).frontMatter?.fields ?? {};
  return { title: noteTitle(text), tags: f.tags ?? [], created: f.created ?? null, broken };
}

/** The facts of either kind, and the text the index keeps for search (SPEC-DRAWINGS 4.6). */
function factsOf(kind: Kind, text: string | null): Pick<Indexed, "title" | "tags" | "created" | "broken" | "text"> {
  if (kind === "note" || text === null) return { ...facts(text), text };
  const f = drawingFacts(text);
  return { title: f.title, tags: f.tags, created: f.created, broken: f.broken, text: f.text };
}

const what = (kind: Kind) => (kind === "note" ? "note" : "drawing");

/** Decodes a note's bytes; the API carries the text exactly as decoded (4.4). */
export function decodeNote(bytes: Uint8Array): string | null {
  return decodeUtf8(bytes);
}

/** The limit of a kind (2 MB for a note, 25 MB for a drawing): 413 past it. */
export function checkSize(bytes: Uint8Array, kind: Kind): void {
  const max = KIND_LIMITS[kind].bytes;
  if (bytes.length > max) {
    const mb = (bytes.length / MB).toFixed(1);
    throw new HttpError(413, kind === "note" ? "A note may be at most 2 MB." : `This drawing is ${mb} MB; a drawing may be at most 25 MB.`, { size: bytes.length, limit: max });
  }
}

/** 4.4: the new bytes of a save: valid UTF-8, at most 2 MB, no broken front matter. A drawing
 *  (SPEC-DRAWINGS 4.4): at most 25 MB, valid UTF-8, a JSON object with `type` "excalidraw" and
 *  an array `elements`. */
export function checkBytes(bytes: Uint8Array, kind: Kind = "note"): string {
  checkSize(bytes, kind);
  const text = decodeUtf8(bytes);
  if (text === null) throw new HttpError(422, "The text is not valid UTF-8.", {}, "not-utf8");
  if (kind === "note") {
    if (hasBrokenFrontMatter(text)) throw new HttpError(422, "The front matter at the top of the note does not parse. Fix it in Raw.", {}, "broken-front-matter");
  } else {
    const problem = drawingProblem(text);
    if (problem === "not-json") throw new HttpError(422, "The drawing is not a JSON object.", {}, "not-json");
    if (problem === "not-excalidraw") throw new HttpError(422, 'The drawing is not an Excalidraw scene: it needs "type": "excalidraw" and a list of elements.', {}, "not-excalidraw");
  }
  return text;
}

/** One line of about 120 characters around the first match (4.5). */
export function excerpt(text: string, needle: string): string {
  const flat = text.replace(/\s+/g, " ");
  const at = flat.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return [...flat.trim()].slice(0, 120).join("");
  const start = Math.max(0, at - 50);
  const out = flat.slice(start, start + 120).trim();
  return (start > 0 ? "…" : "") + out + (start + 120 < flat.length ? "…" : "");
}

export class UserSpace {
  readonly userId: string;
  readonly layout: UserLayout;
  readonly lock = new Mutex();
  readonly index = new Map<string, Indexed>();
  readonly log: Logger;

  constructor(userId: string, layout: UserLayout, log: Logger) {
    this.userId = userId;
    this.layout = layout;
    this.log = log;
  }

  /** Startup: the folders, and `tmp/` emptied (4.3). */
  async start(): Promise<void> {
    await ensureDir(this.layout.root);
    for (const d of [this.layout.notes, this.layout.trash, this.layout.fonts, this.layout.tmp]) await ensureDir(d);
    await emptyDir(this.layout.tmp);
  }

  notePath(noteId: string, part: Parameters<UserLayout["notePath"]>[1], where: "notes" | "trash" = "notes"): string {
    return this.layout.notePath(noteId, part, where);
  }

  // --- the index and the folder check (4.5) ---------------------------------------------------

  /** The kind of a folder, by its main file (SPEC-DRAWINGS 4.1): a regular `note.md` makes a
   *  note; without one, a regular `drawing.excalidraw` makes a drawing; null otherwise. */
  async kindOf(id: string, where: "notes" | "trash" = "notes"): Promise<{ kind: Kind; st: import("node:fs").BigIntStats } | null> {
    for (const kind of ["note", "drawing"] as const) {
      let st;
      try {
        st = await fs.lstatBig(this.notePath(id, MAIN_FILE[kind], where));
      } catch (e) {
        if (isNotFound(e) || errCode(e) === "ENOTDIR") continue;
        throw e;
      }
      if (st.isFile()) return { kind, st };
    }
    return null;
  }

  /** Reads one folder into the index if it changed; null when it is not a live note or drawing. */
  async #check(id: string): Promise<Indexed | null> {
    const dir = this.notePath(id, "dir");
    const dst = await lstatOrNull(dir);
    if (!dst || !dst.isDirectory()) {
      this.index.delete(id);
      return null;
    }
    const found = await this.kindOf(id);
    if (!found) {
      this.index.delete(id);
      return null;
    }
    const { kind, st } = found;
    const known = this.index.get(id);
    if (known && known.kind === kind && known.mtimeNs === st.mtimeNs && known.size === Number(st.size)) return known;
    const bytes = await readRegular(this.notePath(id, MAIN_FILE[kind]));
    if (!bytes) {
      this.index.delete(id);
      return null;
    }
    const e: Indexed = { id, kind, ...factsOf(kind, decodeNote(bytes)), mtimeNs: st.mtimeNs, size: bytes.length };
    // The stat taken before the read says what was read; a write meanwhile is seen next time.
    this.index.set(id, e);
    return e;
  }

  /** The folder check at the start of a list or a search. */
  async checkAll(): Promise<void> {
    const seen = new Set<string>();
    for (const name of await readdirOrEmpty(this.layout.notes)) {
      if (!RE.noteId.test(name)) continue;
      if (await this.#check(name)) seen.add(name);
    }
    for (const id of [...this.index.keys()]) if (!seen.has(id)) this.index.delete(id);
  }

  entryOf(e: Indexed): Entry {
    const out: Entry = { id: e.id, kind: e.kind, title: e.title, tags: e.tags, created: e.created, modified: Number(e.mtimeNs / 1_000_000n), size: e.size };
    if (e.text === null) out.problem = "unreadable";
    else if (e.broken) out.problem = "broken";
    return out;
  }

  /** A live note, checked; 410 when it is in the trash, 404 when unknown. */
  async live(id: string): Promise<Indexed> {
    if (!RE.noteId.test(id)) throw notFound();
    const e = await this.#check(id);
    if (e) return e;
    if (await lstatOrNull(this.notePath(id, "dir", "trash"))) throw trashed();
    throw notFound();
  }

  // --- reading ----------------------------------------------------------------------------------

  async list(tag?: string, q?: string): Promise<{ entries: Entry[]; tags: { tag: string; count: number }[] }> {
    await this.checkAll();
    const all = [...this.index.values()];
    const counts = new Map<string, number>();
    for (const e of all) for (const t of new Set(e.tags)) counts.set(t, (counts.get(t) ?? 0) + 1);
    let picked = all;
    if (tag) picked = picked.filter((e) => e.tags.includes(tag));
    // A kept space (U+00A0, SPEC-NOTES "The kept space") is found by a typed space, and the
    // other way round (review of alpha's changes, 14).
    const fold = (t: string) => plainSpaces(t).toLowerCase();
    const needle = fold(q?.trim() ?? "");
    if (needle) picked = picked.filter((e) => fold(e.title).includes(needle) || e.tags.some((t) => fold(t).includes(needle)) || fold(e.text ?? "").includes(needle));
    picked.sort((a, b) => (b.mtimeNs > a.mtimeNs ? 1 : b.mtimeNs < a.mtimeNs ? -1 : a.id.localeCompare(b.id)));
    const entries = picked.map((e) => (needle ? { ...this.entryOf(e), excerpt: excerpt(e.text ?? "", needle) } : this.entryOf(e)));
    const tags = [...counts].map(([t, count]) => ({ tag: t, count })).sort((a, b) => a.tag.localeCompare(b.tag));
    return { entries, tags };
  }

  async read(id: string): Promise<NoteDoc> {
    const e = await this.live(id);
    const bytes = await readRegular(this.notePath(id, MAIN_FILE[e.kind]));
    if (!bytes) throw notFound();
    const text = decodeNote(bytes);
    if (text === null) throw new HttpError(422, `This ${what(e.kind)} is not valid UTF-8 and cannot be opened.`, {}, "not-utf8");
    return { text, revision: revisionOf(bytes), entry: this.entryOf(e) };
  }

  // --- creating (4.3, 4.7) ---------------------------------------------------------------------

  /** A new id that is neither live nor in the trash. */
  async #newId(): Promise<string> {
    for (;;) {
      const id = newNoteId();
      if (!(await lstatOrNull(this.notePath(id, "dir"))) && !(await lstatOrNull(this.notePath(id, "dir", "trash")))) return id;
    }
  }

  /** "Untitled N": the smallest N from 1 that no live note's or drawing's title uses. */
  async #untitled(): Promise<string> {
    await this.checkAll();
    const used = new Set([...this.index.values()].map((e) => e.title));
    for (let n = 1; ; n++) if (!used.has(`Untitled ${n}`)) return `Untitled ${n}`;
  }

  /** Builds a folder in `tmp/` and renames it into `notes/` (4.3, Create). */
  async #build(text: string, assetsFrom: string | null, kind: Kind = "note"): Promise<string> {
    const id = await this.#newId();
    const build = path.join(this.layout.tmp, `new-${id}-${randomBase32(6)}`);
    await fs.mkdir(build, { mode: 0o700 });
    try {
      const fh = await fs.open(path.join(build, MAIN_FILE[kind]), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      try {
        await fh.writeFile(Buffer.from(text, "utf8"));
        await fh.sync();
      } finally {
        await fh.close();
      }
      if (assetsFrom) await this.#copyAssets(assetsFrom, path.join(build, "note.assets"));
      await fsyncDir(build);
      step("create:built");
      await fs.rename(build, this.notePath(id, "dir"));
      step("create:renamed");
      await fsyncDir(this.layout.notes);
      await fsyncDir(this.layout.tmp);
    } catch (e) {
      await fs.rm(build, { recursive: true, force: true }).catch(() => {});
      throw e;
    }
    return id;
  }

  /** A copy of a note's photos: new files with their own bytes, never links (4.1, rule 3). */
  async #copyAssets(from: string, to: string): Promise<void> {
    const st = await lstatOrNull(from);
    if (!st || !st.isDirectory()) return;
    await fs.mkdir(to, { mode: 0o700 });
    for (const name of await readdirOrEmpty(from)) {
      if (!RE.photoFile.test(name)) continue;
      const data = await readRegular(path.join(from, name));
      if (!data) continue;
      const fh = await fs.open(path.join(to, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      try {
        await fh.writeFile(data);
        await fh.sync();
      } finally {
        await fh.close();
      }
    }
    await fsyncDir(to);
  }

  async create(title: string | undefined, kind: Kind = "note"): Promise<NoteDoc & { id: string }> {
    let t = cleanTitle(title ?? "");
    if (t === "") t = await this.#untitled();
    const text = kind === "note" ? newNoteText(t, today()) : emptyDrawing(t, today());
    const id = await this.#build(text, null, kind);
    return { id, ...(await this.read(id)) };
  }

  /** 4.7: save as a new note, with the source's photos if it is live or in the trash. A drawing
   *  (SPEC-DRAWINGS 4.5): the images its elements use that the draft lacks come from the
   *  source's file. */
  async saveAsNew(bytes: Uint8Array, from: string | undefined, kind: Kind = "note"): Promise<NoteDoc & { id: string; photosMissing: boolean }> {
    if (kind === "drawing") return this.#saveDrawingAsNew(bytes, from);
    const text = checkBytes(bytes);
    let source: string | null = null;
    if (from && RE.noteId.test(from)) {
      for (const where of ["notes", "trash"] as const) {
        if (source) break;
        const dir = this.notePath(from, "dir", where);
        const st = await lstatOrNull(dir);
        // Only a note has photos: a drawing's id is not a source (review, 18-4).
        if (st?.isDirectory() && (await this.kindOf(from, where))?.kind === "note") source = this.notePath(from, "note.assets", where);
      }
    }
    const usesPhotos = /\]\(\s*<?note\.assets\//.test(text);
    const id = await this.#build(text, source);
    return { id, ...(await this.read(id)), photosMissing: usesPhotos && source === null };
  }

  async #saveDrawingAsNew(bytes: Uint8Array, from: string | undefined): Promise<NoteDoc & { id: string; photosMissing: boolean }> {
    const text = checkBytes(bytes, "drawing");
    const doc = parseDrawing(text).doc!;
    const files: Record<string, unknown> = typeof doc.files === "object" && doc.files !== null && !Array.isArray(doc.files) ? { ...(doc.files as Record<string, unknown>) } : {};
    const wanted = usedFileIds(doc.elements as unknown[]).filter((f) => files[f] === undefined);
    let out = text;
    if (wanted.length && from && RE.noteId.test(from)) {
      let sourceFiles: Record<string, unknown> = {};
      for (const where of ["notes", "trash"] as const) {
        const found = await this.kindOf(from, where);
        if (!found || found.kind !== "drawing") continue;
        const src = await readRegular(this.notePath(from, "drawing.excalidraw", where));
        const srcText = src ? decodeNote(src) : null;
        const srcDoc = srcText === null ? null : parseDrawing(srcText).doc;
        if (srcDoc && typeof srcDoc.files === "object" && srcDoc.files !== null && !Array.isArray(srcDoc.files)) sourceFiles = srcDoc.files as Record<string, unknown>;
        break;
      }
      let filled = false;
      for (const f of wanted) {
        if (sourceFiles[f] === undefined) continue;
        files[f] = sourceFiles[f];
        filled = true;
      }
      if (filled) {
        const sorted: Record<string, unknown> = {};
        for (const k of Object.keys(files).sort()) sorted[k] = files[k];
        out = JSON.stringify({ ...doc, files: sorted }, null, 2) + "\n";
        checkBytes(Buffer.from(out, "utf8"), "drawing");
      }
    }
    const missing = usedFileIds(doc.elements as unknown[]).some((f) => files[f] === undefined);
    const id = await this.#build(out, null, "drawing");
    return { id, ...(await this.read(id)), photosMissing: missing };
  }

  // --- saving (4.4) ------------------------------------------------------------------------------

  async save(id: string, sent: string, bytes: Uint8Array, kind: Kind = "note"): Promise<{ revision: string; entry: Entry }> {
    // 1. Find the note or drawing; a body of the other kind is refused (SPEC-DRAWINGS 5).
    const item = await this.live(id);
    if (item.kind !== kind) throw new HttpError(415, item.kind === "note" ? "This is a note: it is saved as text/markdown." : "This is a drawing: it is saved as an Excalidraw file.");
    // Then the limit of that kind (SPEC-DRAWINGS 5), before the comparison.
    checkSize(bytes, kind);
    const file = this.notePath(id, MAIN_FILE[kind]);
    // 2. Compare.
    const old = await readRegular(file);
    if (!old) throw notFound();
    const current = revisionOf(old);
    if (current !== sent) {
      const text = decodeNote(old);
      const e = await this.#check(id);
      throw new HttpError(409, `The ${what(kind)} was changed since you opened it.`, text === null || !e ? {} : { current: { text, revision: current, entry: this.entryOf(e) } }, "changed");
    }
    // 3. Check the new bytes.
    checkBytes(bytes, kind);
    // 4. Nothing changed: write nothing.
    if (Buffer.compare(Buffer.from(old), Buffer.from(bytes)) === 0) {
      const e = await this.#check(id);
      return { revision: current, entry: this.entryOf(e!) };
    }
    // 5. The old bytes go to history as a new file.
    const hist = this.notePath(id, "history");
    await ensureDir(hist);
    for (;;) {
      const version = makeVersion(new Date());
      try {
        await createFile(this.layout.tmp, this.notePath(id, { version, kind }), old);
        break;
      } catch (e) {
        if (errCode(e) !== "EEXIST") throw e;
      }
    }
    step("save:history");
    // 6. Replace the note.
    await replaceFile(this.layout.tmp, file, bytes);
    step("save:replaced");
    // 7. History beyond the newest 50 goes (20 for a drawing).
    const ext = EXT[kind];
    const versions = (await readdirOrEmpty(hist)).filter((n) => n.endsWith(ext) && RE.version.test(n.slice(0, -ext.length))).sort();
    const extra = versions.slice(0, Math.max(0, versions.length - KIND_LIMITS[kind].history));
    for (const n of extra) await fs.rm(path.join(hist, n), { force: true });
    // Synced, so a crash cannot bring removed versions back (4.4: at worst one extra file).
    if (extra.length) await fsyncDir(hist);
    // 8. Answer.
    const e = await this.#check(id);
    return { revision: revisionOf(bytes), entry: this.entryOf(e!) };
  }

  // --- trash (4.3) -------------------------------------------------------------------------------

  async trash(id: string): Promise<void> {
    await this.live(id);
    if (await lstatOrNull(this.notePath(id, "dir", "trash"))) throw new HttpError(409, "A note with this id is already in the trash.");
    await replaceFile(this.layout.tmp, this.notePath(id, "trashed.json"), Buffer.from(JSON.stringify({ trashed: new Date().toISOString() })));
    step("trash:marked");
    await fs.rename(this.notePath(id, "dir"), this.notePath(id, "dir", "trash"));
    step("trash:moved");
    await fsyncDir(this.layout.trash);
    await fsyncDir(this.layout.notes);
    this.index.delete(id);
  }

  async restore(id: string): Promise<Entry> {
    if (!RE.noteId.test(id)) throw notFound();
    const dir = this.notePath(id, "dir", "trash");
    const st = await lstatOrNull(dir);
    if (!st?.isDirectory()) throw new HttpError(404, "There is no such note in the trash.");
    if (await lstatOrNull(this.notePath(id, "dir"))) throw new HttpError(409, "A note with this id already exists.");
    await fs.rename(dir, this.notePath(id, "dir"));
    step("restore:moved");
    await fsyncDir(this.layout.notes);
    await fsyncDir(this.layout.trash);
    await fs.rm(this.notePath(id, "trashed.json"), { force: true });
    step("restore:unmarked");
    const e = await this.#check(id);
    if (!e) throw notFound();
    return this.entryOf(e);
  }

  /** For each id sent that is still in `trash/`: rename the folder into `tmp/`, then delete it. */
  async empty(ids: string[]): Promise<string[]> {
    const removed: string[] = [];
    for (const id of new Set(ids)) {
      if (!RE.noteId.test(id)) continue;
      const dir = this.notePath(id, "dir", "trash");
      const st = await lstatOrNull(dir);
      if (!st?.isDirectory()) continue;
      const gone = path.join(this.layout.tmp, `gone-${id}-${randomBase32(6)}`);
      await fs.rename(dir, gone);
      step("empty:moved");
      // Rule 3: both parents of a rename are synced.
      await fsyncDir(this.layout.trash);
      await fsyncDir(this.layout.tmp);
      await fs.rm(gone, { recursive: true, force: true });
      removed.push(id);
    }
    return removed;
  }

  async #trashEntry(id: string): Promise<{ entry: TrashEntry; text: string | null } | null> {
    const dir = this.notePath(id, "dir", "trash");
    const st = await lstatOrNull(dir);
    if (!st?.isDirectory()) return null;
    const found = await this.kindOf(id, "trash");
    if (!found) return null;
    const kind = found.kind;
    const bytes = await readRegular(this.notePath(id, MAIN_FILE[kind], "trash"));
    if (!bytes) return null;
    const text = decodeNote(bytes);
    let when: string | null = null;
    const meta = await readRegular(this.notePath(id, "trashed.json", "trash"));
    if (meta) {
      try {
        const t = JSON.parse(meta.toString("utf8")).trashed;
        if (typeof t === "string") when = t;
      } catch {
        when = null;
      }
    }
    const f = factsOf(kind, text);
    return { entry: { id, kind, title: f.title, tags: f.tags, trashed: when, size: bytes.length }, text };
  }

  async listTrash(): Promise<TrashEntry[]> {
    const out: TrashEntry[] = [];
    for (const name of await readdirOrEmpty(this.layout.trash)) {
      if (!RE.noteId.test(name)) continue;
      const t = await this.#trashEntry(name);
      if (t) out.push(t.entry);
    }
    return out.sort((a, b) => (b.trashed ?? "").localeCompare(a.trashed ?? ""));
  }

  async readTrash(id: string): Promise<{ text: string; entry: TrashEntry }> {
    if (!RE.noteId.test(id)) throw notFound();
    const t = await this.#trashEntry(id);
    if (!t) throw new HttpError(404, "There is no such note in the trash.");
    // As for a live note (4.5): a file that is not UTF-8 cannot be opened; it stays listed and
    // can be restored or deleted.
    if (t.text === null) throw new HttpError(422, `This ${what(t.entry.kind)} is not valid UTF-8 and cannot be opened.`, {}, "not-utf8");
    return { text: t.text, entry: t.entry };
  }

  // --- history (4.6) ---------------------------------------------------------------------------

  async history(id: string): Promise<HistoryEntry[]> {
    const { kind } = await this.live(id);
    const ext = EXT[kind];
    const dir = this.notePath(id, "history");
    const out: HistoryEntry[] = [];
    for (const n of await readdirOrEmpty(dir)) {
      if (!n.endsWith(ext)) continue;
      const version = n.slice(0, -ext.length);
      if (!RE.version.test(version)) continue;
      const st = await lstatOrNull(path.join(dir, n));
      if (!st?.isFile()) continue;
      const time = version.slice(0, 24).replace(/^(\d{4}-\d\d-\d\dT\d\d)-(\d\d)-(\d\d\.\d{3}Z)$/, "$1:$2:$3");
      out.push({ version, time, size: st.size });
    }
    return out.sort((a, b) => b.version.localeCompare(a.version));
  }

  async version(id: string, version: string): Promise<string> {
    const { kind } = await this.live(id);
    if (!RE.version.test(version)) throw new HttpError(404, "There is no such version.");
    const bytes = await readRegular(this.notePath(id, { version, kind }));
    if (!bytes) throw new HttpError(404, "There is no such version.");
    const text = decodeNote(bytes);
    if (text === null) throw new HttpError(422, "This version is not valid UTF-8.", {}, "not-utf8");
    return text;
  }

  // --- assets ------------------------------------------------------------------------------------

  /** Opens a photo for serving, under the lock; it is sent after the lock is released. */
  async openAsset(id: string, file: string, where: "notes" | "trash"): Promise<{ fh: FileHandle; size: number; head: Buffer }> {
    const missing = () => new HttpError(404, "There is no such photo.");
    if (where === "notes") {
      // A drawing's images are inside its file (SPEC-DRAWINGS 1.1, 5): no photo route for it.
      if ((await this.live(id)).kind === "drawing") throw missing();
    } else {
      if (!(await lstatOrNull(this.notePath(id, "dir", "trash")))?.isDirectory()) throw new HttpError(404, "There is no such note in the trash.");
      if ((await this.kindOf(id, "trash"))?.kind === "drawing") throw missing();
    }
    if (!RE.photoFile.test(file)) throw missing();
    const dirSt = await lstatOrNull(this.notePath(id, "note.assets", where));
    if (!dirSt?.isDirectory()) throw missing();
    let fh: FileHandle;
    try {
      fh = await fs.open(this.notePath(id, { asset: file }, where), constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (e) {
      if (isNotFound(e) || errCode(e) === "ELOOP") throw missing();
      throw e;
    }
    try {
      const st = await fh.stat();
      if (!st.isFile()) throw missing();
      const head = Buffer.alloc(64);
      const { bytesRead } = await fh.read(head, 0, 64, 0);
      return { fh, size: st.size, head: head.subarray(0, bytesRead) };
    } catch (e) {
      await fh.close();
      throw e;
    }
  }

  /** Stores a processed photo under a free name in the note's `note.assets/` (section 6). */
  async storePhoto(id: string, base: string, ext: string, data: Buffer): Promise<string> {
    if ((await this.live(id)).kind === "drawing") throw new HttpError(404, "A drawing keeps its images inside its file.");
    const dir = this.notePath(id, "note.assets");
    const st = await lstatOrNull(dir);
    if (st && !st.isDirectory()) throw new HttpError(409, "The note's photo folder is not a folder.");
    await ensureDir(dir);
    for (let n = 1; ; n++) {
      const file = (n === 1 ? base : `${base}-${n}`) + ext;
      try {
        await createFile(this.layout.tmp, this.notePath(id, { asset: file }), data);
        return file;
      } catch (e) {
        if (errCode(e) === "EEXIST") continue;
        throw e;
      }
    }
  }
}

/** Every user's space; `run` is the one way in (4.1, rule 2). */
export class Spaces {
  readonly layout: DataLayout;
  readonly log: Logger;
  readonly #spaces = new Map<string, UserSpace>();

  constructor(layout: DataLayout, log: Logger) {
    this.layout = layout;
    this.log = log;
  }

  get(userId: string): UserSpace {
    let s = this.#spaces.get(userId);
    if (!s) {
      s = new UserSpace(userId, this.layout.user(userId), this.log);
      this.#spaces.set(userId, s);
    }
    return s;
  }

  forget(userId: string): void {
    this.#spaces.delete(userId);
  }

  /** Holds the user's lock while `fn` runs. */
  run<T>(userId: string, fn: (s: UserSpace) => Promise<T>): Promise<T> {
    const s = this.get(userId);
    return s.lock.run(() => fn(s));
  }

  /** The note path function of section 5. */
  notePath(userId: string, noteId: string, part: Parameters<UserLayout["notePath"]>[1]): string {
    return this.get(userId).notePath(noteId, part);
  }
}
