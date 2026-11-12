// SPEC2 9.2 and 4.4, 9.5: the open note: id, base revision, saved text, line ending and byte
// order mark, saving, conflict, mode. The view registers a `getText()` with it; `dirty` is that
// text compared with the saved text. The editor's text, selection and `typing` live in
// CodeMirror and nowhere else.

import type { Entry, NoteDoc } from "../../../contract/src/index.ts";
import { load, serialize, type Eol, type Mode } from "../../../core/src/index.ts";
import { api, ApiError } from "../lib/api.ts";
import { drafts, type Draft } from "./drafts.svelte.ts";
import { library } from "./library.svelte.ts";
import { prefs } from "./prefs.svelte.ts";
import { session } from "./session.svelte.ts";
import { toasts } from "./toasts.svelte.ts";

export type SaveState = "saved" | "dirty" | "saving" | "error";
export type Conflict = null | { kind: "changed"; current: NoteDoc | null } | { kind: "gone"; status: number };

/** What the view gives the store: its text, and loading a text ("Take theirs", a draft). */
export interface ViewHandle {
  getText(): string;
  setText(text: string): void;
  /** Writes into the text what is held outside it: a focused table cell's unsaved content (7.7).
   *  Called before the text is read for a save, a draft or the "unsaved changes" check. */
  flush?(): void;
}

/** How long typing must stop before a draft is stored. */
export const DRAFT_DELAY = 600;

const blank = () => ({
  id: null as string | null,
  editorId: "",
  base: "",
  saved: "",
  /** The line ending and byte order mark of the saved bytes: with `saved`, what `dirty` compares
   *  against, so a text equal to the saved one with other bytes is not "saved" (4.4). */
  savedEol: "\n" as Eol,
  savedBom: false,
  eol: "\n" as Eol,
  bom: false,
  mixed: false,
  mixedWarned: false,
  entry: null as Entry | null,
  loading: false,
  loadError: null as string | null,
  saving: false,
  queued: false,
  conflict: null as Conflict,
  error: null as string | null,
  dirty: false,
  /** The person's text kept by "Take theirs", shown in a box to copy. */
  rescued: null as string | null,
  /** Drafts found for this note when it was opened. */
  offered: [] as Draft[],
  photosMissing: false,
  loadedText: "",
});

const s = $state(blank());
const mode = $state({ value: prefs.mode as Mode });
let view: ViewHandle | null = null;
let draftTimer: ReturnType<typeof setTimeout> | null = null;
/** Bumped on every open, so a late answer for an earlier note changes nothing on screen. */
let generation = 0;

function text(): string {
  return view ? view.getText() : s.saved;
}

function userId(): string {
  return session.user?.id ?? "";
}

/** Whether a text, with the open note's line ending and byte order mark, differs from the saved
 *  bytes. */
function differs(t: string): boolean {
  if (t !== s.saved || s.bom !== s.savedBom) return true;
  return s.eol !== s.savedEol && t.includes("\n");
}

/** Writes a focused table cell into the text before the text is read (7.7). */
function flushView(): void {
  view?.flush?.();
}

function storeDraftNow(): void {
  if (!s.id || !userId()) return;
  const t = text();
  if (!differs(t)) {
    const d = drafts.get(userId(), s.id, s.editorId);
    if (d) drafts.remove(d.key);
    return;
  }
  drafts.put(userId(), s.id, s.editorId, serialize(t, s.eol, s.bom), s.base);
}

function adopt(doc: { text: string; revision: string; entry: Entry }): void {
  const l = load(doc.text);
  s.base = doc.revision;
  s.saved = l.text;
  s.eol = l.eol;
  s.bom = l.bom;
  s.savedEol = l.eol;
  s.savedBom = l.bom;
  s.mixed = l.mixed;
  s.entry = doc.entry;
  s.loadedText = l.text;
}

export const editor = {
  get id() {
    return s.id;
  },
  get editorId() {
    return s.editorId;
  },
  get base() {
    return s.base;
  },
  get savedText() {
    return s.saved;
  },
  get eol() {
    return s.eol;
  },
  get bom() {
    return s.bom;
  },
  get mixed() {
    return s.mixed;
  },
  get entry() {
    return s.entry;
  },
  get loading() {
    return s.loading;
  },
  get loadError() {
    return s.loadError;
  },
  get saving() {
    return s.saving;
  },
  get queued() {
    return s.queued;
  },
  get conflict() {
    return s.conflict;
  },
  get dirty() {
    return s.dirty;
  },
  get rescued() {
    return s.rescued;
  },
  get offered() {
    return s.offered;
  },
  get mode(): Mode {
    return mode.value;
  },
  /** The text the view starts with. */
  get loadedText() {
    return s.loadedText;
  },
  get saveState(): SaveState {
    if (s.saving) return "saving";
    if (s.error || s.conflict) return "error";
    return s.dirty ? "dirty" : "saved";
  },
  get error() {
    return s.error;
  },

  register(h: ViewHandle | null): void {
    view = h;
    editor.changed();
  },

  /** The view's text changed: `dirty` again, and a draft a moment after typing stops. */
  changed(): void {
    s.dirty = s.id !== null && differs(text());
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(storeDraftNow, DRAFT_DELAY);
  },

  /** Whether there are unsaved changes, once a focused table cell has been written into the text
   *  (leaving the note: Back, another screen, closing or reloading the page). */
  unsaved(): boolean {
    flushView();
    return s.dirty;
  },

  /** Stores the draft now (tests, and leaving the page). */
  flushDraft(): void {
    flushView();
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = null;
    storeDraftNow();
  },

  /** Opens a note; offers every draft found for it. */
  async open(id: string): Promise<void> {
    const g = ++generation;
    if (draftTimer) clearTimeout(draftTimer);
    Object.assign(s, blank(), { id, loading: true, editorId: drafts.newEditorId() });
    try {
      const doc = await api().read(id);
      if (g !== generation) return;
      adopt(doc);
      s.loading = false;
      s.offered = drafts.forNote(userId(), id, s.editorId);
      if (s.mixed) toasts.push("This note mixes line endings. They will become LF when it is saved.", "warn");
    } catch (e) {
      if (g !== generation) return;
      s.loading = false;
      s.loadError = e instanceof ApiError ? (e.status === 410 ? "This note is in the trash." : e.status === 404 ? "There is no such note." : e.message) : "The note could not be opened.";
    }
  },

  /** Leaves the note (another screen). */
  close(): void {
    if (s.id) editor.flushDraft();
    generation++;
    view = null;
    Object.assign(s, blank());
  },

  setMode(m: Mode): void {
    mode.value = m;
    prefs.setMode(m);
  },

  /** 4.4: one save at a time; a Save pressed meanwhile is queued, at most one. */
  async save(): Promise<void> {
    if (!s.id || s.loading || s.loadError) return;
    flushView();
    if (s.saving) {
      s.queued = true;
      return;
    }
    if (s.conflict) {
      // The banner holds the choice; Save says so rather than doing nothing (review, 28).
      toasts.push(s.conflict.kind === "changed" ? "This note was changed elsewhere: choose Keep mine or Take theirs first." : "This note is gone: use Save as a new note to keep your text.", "warn");
      return;
    }
    if (s.mixed && !s.mixedWarned) {
      s.mixedWarned = true;
      toasts.push("The mixed line endings of this note become LF in this save.", "warn");
    }
    const g = generation;
    const id = s.id;
    const editorId = s.editorId;
    const uid = userId();
    const lf = text();
    const eol = s.eol;
    const bom = s.bom;
    const bytes = serialize(lf, eol, bom);
    s.saving = true;
    s.error = null;
    try {
      const r = await api().save(id, bytes, s.base);
      // A late answer for a note the person has left only removes that editor's draft.
      drafts.removeIfSaved(uid, id, editorId, bytes);
      if (g !== generation) return;
      s.base = r.revision;
      s.saved = lf;
      s.savedEol = eol;
      s.savedBom = bom;
      s.entry = r.entry;
      s.saving = false;
      s.mixed = false;
      editor.changed();
      if (!differs(text())) {
        const d = drafts.get(uid, id, editorId);
        if (d) drafts.remove(d.key);
      }
      void library.refresh();
      if (s.queued) {
        s.queued = false;
        await editor.save();
      }
    } catch (e) {
      if (g !== generation) return;
      s.saving = false;
      s.queued = false;
      if (e instanceof ApiError && e.status === 409 && e.code === "changed") {
        s.conflict = { kind: "changed", current: (e.body.current as NoteDoc | undefined) ?? null };
      } else if (e instanceof ApiError && (e.status === 410 || e.status === 404)) {
        s.conflict = { kind: "gone", status: e.status };
      } else {
        s.error = e instanceof Error ? e.message : "The note could not be saved.";
        toasts.push(`Not saved: ${s.error}`, "error");
      }
    }
  },

  /** 9.5 Keep mine: saves again from the newer revision. */
  async keepMine(): Promise<void> {
    const c = s.conflict;
    if (!c || c.kind !== "changed") return;
    if (c.current) s.base = c.current.revision;
    else {
      const g = generation;
      let revision: string;
      try {
        revision = (await api().read(s.id!)).revision;
      } catch (e) {
        if (g === generation) toasts.push(`The newer text could not be read: ${e instanceof Error ? e.message : ""}. Your text is kept; try again.`, "error");
        return;
      }
      if (g !== generation) return;
      s.base = revision;
    }
    s.conflict = null;
    await editor.save();
  },

  /** 9.5 Take theirs: loads the newer text, first storing the person's text as a draft. */
  async takeTheirs(): Promise<void> {
    const c = s.conflict;
    if (!c || c.kind !== "changed" || !s.id) return;
    flushView();
    const g = generation;
    const id = s.id;
    const uid = userId();
    let doc = c.current;
    if (!doc) {
      try {
        doc = await api().read(id);
      } catch (e) {
        if (g === generation) toasts.push(`The newer text could not be read: ${e instanceof Error ? e.message : ""}. Your text is kept; try again.`, "error");
        return;
      }
      if (g !== generation) return;
    }
    const mine = serialize(text(), s.eol, s.bom);
    // The person's text is kept as a draft of another editor, so it is offered next time.
    if (drafts.put(uid, id, drafts.newEditorId(), mine, s.base)) {
      const d = drafts.get(uid, id, s.editorId);
      if (d) drafts.remove(d.key);
    } else {
      // The browser refused it (its warning is on screen). This editor takes a new id, so the
      // draft it stored before, if any, is not removed: it stays and is offered next time.
      s.editorId = drafts.newEditorId();
    }
    adopt(doc);
    s.rescued = mine;
    s.conflict = null;
    view?.setText(s.saved);
    editor.changed();
  },

  dismissRescued(): void {
    s.rescued = null;
  },

  /** 4.7: offered when a save meets 410 or 404, and for a draft whose note is gone. */
  async saveAsNew(textOverride?: string, from?: string): Promise<string | null> {
    const own = textOverride === undefined;
    if (own) flushView();
    const t = textOverride ?? serialize(text(), s.eol, s.bom);
    const source = from ?? s.id ?? undefined;
    const g = generation;
    const id = s.id;
    const editorId = s.editorId;
    const uid = userId();
    try {
      const r = await api().saveAsNew(t, source);
      if (id && own) {
        const d = drafts.get(uid, id, editorId);
        // Text typed while the request was out goes with the new note as its draft, offered
        // when it opens; this editor's draft is removed only once nothing in it is lost.
        const now = g === generation ? serialize(text(), s.eol, s.bom) : (d?.text ?? t);
        if (now === t || drafts.put(uid, r.id, drafts.newEditorId(), now, r.revision)) {
          if (d) drafts.remove(d.key);
        }
      }
      s.photosMissing = r.photosMissing;
      if (r.photosMissing) toasts.push("Saved as a new note. Its photos could not be found, so they are missing.", "warn", 8000);
      else toasts.push("Saved as a new note.", "info");
      void library.refresh();
      return r.id;
    } catch (e) {
      toasts.push(`Not saved: ${e instanceof Error ? e.message : "the note could not be made"}`, "error");
      return null;
    }
  },

  /** 9.5: opening a draft stores it under the current editor id, and takes its base revision. */
  async openDraft(d: Draft): Promise<void> {
    flushView();
    const t = text();
    if (differs(t)) {
      // Text typed since the note opened would be replaced: ask first, and keep it as another
      // draft, offered the next time the note is opened.
      const g = generation;
      const ok = await toasts.confirm("Open this draft? It replaces what you typed since you opened the note; that text is kept as a draft.", { ok: "Open the draft" });
      if (!ok || g !== generation) return;
      flushView();
      if (!drafts.put(userId(), s.id!, drafts.newEditorId(), serialize(text(), s.eol, s.bom), s.base)) {
        toasts.push("Your text could not be kept as a draft (this browser refuses to store it), so the draft was not opened.", "error");
        return;
      }
    }
    if (!drafts.adopt(d, s.editorId)) return;
    const l = load(d.text);
    s.base = d.base;
    s.eol = l.eol;
    s.bom = l.bom;
    view?.setText(l.text);
    s.offered = s.offered.filter((x) => x.key !== d.key);
    editor.changed();
  },

  discardDraft(d: Draft): void {
    drafts.remove(d.key);
    s.offered = s.offered.filter((x) => x.key !== d.key);
  },

  /** Uploads a photo to the open note; its stored name. */
  async upload(file: Blob & { name?: string }): Promise<string> {
    if (!s.id) throw new Error("no note is open");
    return (await api().upload(s.id, file, file.name || "photo")).file;
  },

  /** A title or other settings change came from the server's answer (the list entry). */
  setEntry(e: Entry): void {
    s.entry = e;
  },
};
