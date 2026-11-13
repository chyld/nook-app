// SPEC2 9.2 and 4.4, 9.5: the open note: id, base revision, saved text, line ending and byte
// order mark, saving, conflict, mode. The view registers a `getText()` with it; `dirty` is that
// text compared with the saved text. The editor's text, selection and `typing` live in
// CodeMirror and nowhere else.
//
// SPEC-DRAWINGS 6: the store has a kind. For a drawing it does not use `core`'s `load` and
// `serialize`: the view gives its scene (`scene()`), from which the store makes the text to save
// (4.2) and the text of a draft (4.5, without images), and "unsaved" is the drawing's signature
// compared with the baseline (4.3). The title and tags of a drawing live here.

import { MB, type Entry, type Kind, type NoteDoc } from "../../../contract/src/index.ts";
import { drawingFacts, drawingSignature, load, parseDrawing, sceneOf, serialize, serializeDrawing, usedFileIds, type DrawingNook, type DrawingScene, type Eol, type Mode } from "../../../core/src/index.ts";
import { api, ApiError } from "../lib/api.ts";
import { router } from "../lib/router.svelte.ts";
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
   *  Called before the text is read for a save, a draft or the "unsaved changes" check. A
   *  drawing's view tells the store of its last change at once (SPEC-DRAWINGS 4.3). */
  flush?(): void;
  /** A drawing's view: the scene as Excalidraw has it. */
  scene?(): DrawingScene;
  /** A drawing's view: replaces the scene; resolves once the drawing is ready again (4.3). */
  load?(scene: DrawingScene): Promise<void>;
  /** A drawing's view: false while it remounts (Take theirs, a draft). */
  isReady?(): boolean;
}

/** The address of an item of a kind. */
export const itemPath = (kind: Kind, id: string) => `/${kind === "note" ? "n" : "d"}/${id}`;

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
  /** SPEC-DRAWINGS 6: the open item's kind, and for a drawing its title, tags and date, and the
   *  signature of what was last read or saved (4.3). */
  kind: "note" as Kind,
  nook: { title: "", tags: [], created: null } as DrawingNook,
  baseline: "",
  /** The item turned out to be of the other kind: the store has gone to its address. */
  wrongKind: false,
  /** Saved as a new item: this one is left, and no draft of it is stored any more. */
  movedOn: false,
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

const drawing = () => s.kind === "drawing";
const what = () => (drawing() ? "drawing" : "note");

/** A drawing's scene: the view's, or the saved file's while there is no view. */
function scene(): DrawingScene {
  return view?.scene?.() ?? sceneOf(s.saved) ?? { elements: [], appState: {}, files: {} };
}
/** 4.3: the signature of the drawing on screen. */
function signature(sc: DrawingScene = scene()): string {
  return drawingSignature(sc.elements, sc.appState, s.nook.title, s.nook.tags);
}
/** 4.5: a drawing's draft: its serialization with `files` empty. */
function draftText(sc: DrawingScene = scene()): string {
  return serializeDrawing({ ...sc, files: {} }, s.nook);
}
/** The text a save sends: a note's bytes, or a drawing's whole file (4.4). */
function saveText(): string {
  return drawing() ? serializeDrawing(scene(), s.nook) : serialize(text(), s.eol, s.bom);
}
/** Whether what is on screen differs from what was last read or saved. */
function unsavedNow(): boolean {
  if (drawing()) {
    // Before the view is ready nothing can change (the header waits for it too); while it
    // remounts, what was known stays.
    if (!viewReady()) return view?.scene !== undefined && s.dirty;
    return signature() !== s.baseline;
  }
  return differs(text());
}

/** A drawing's view is registered and ready (4.3). */
function viewReady(): boolean {
  return view?.scene !== undefined && (view.isReady?.() ?? true);
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
  if (!s.id || !userId() || s.loading || s.movedOn) return;
  if (drawing()) {
    if (!view?.scene) return;
    if (!unsavedNow()) {
      const d = drafts.get(userId(), s.id, s.editorId);
      if (d) drafts.remove(d.key);
      return;
    }
    drafts.put(userId(), s.id, s.editorId, draftText(), s.base, Date.now(), "drawing");
    return;
  }
  const t = text();
  if (!differs(t)) {
    const d = drafts.get(userId(), s.id, s.editorId);
    if (d) drafts.remove(d.key);
    return;
  }
  drafts.put(userId(), s.id, s.editorId, serialize(t, s.eol, s.bom), s.base);
}

function adopt(doc: { text: string; revision: string; entry: Entry }): void {
  s.kind = doc.entry.kind;
  if (doc.entry.kind === "drawing") {
    const f = drawingFacts(doc.text);
    s.base = doc.revision;
    s.saved = doc.text;
    s.nook = { title: f.title, tags: f.tags, created: f.created };
    s.entry = doc.entry;
    s.loadedText = doc.text;
    s.eol = "\n";
    s.bom = false;
    s.savedEol = "\n";
    s.savedBom = false;
    s.mixed = false;
    return;
  }
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
  get kind(): Kind {
    return s.kind;
  },
  /** A drawing's title, tags and date (SPEC-DRAWINGS 4.2). */
  get nook(): DrawingNook {
    return s.nook;
  },
  get wrongKind(): boolean {
    return s.wrongKind;
  },
  /** A drawing's whole text (4.2): the test hook's `text()`. */
  drawingText(): string {
    return serializeDrawing(scene(), s.nook);
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
    // A drawing's view registers once it is ready after its file was read: the baseline (4.3).
    // Its title and tags are those of the file read, so a change made before is unsaved.
    if (h?.scene && drawing()) {
      const f = drawingFacts(s.saved);
      const sc = h.scene();
      s.baseline = drawingSignature(sc.elements, sc.appState, f.title, f.tags);
    }
    editor.changed();
  },

  /** A drawing's title or tags changed (unsaved until Save). */
  setNook(n: Partial<Pick<DrawingNook, "title" | "tags">>): void {
    s.nook = { ...s.nook, ...n };
    editor.changed();
  },

  /** The view's text changed: `dirty` again, and a draft a moment after typing stops. */
  changed(): void {
    s.dirty = s.id !== null && !s.loading && unsavedNow();
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

  /** Opens a note or a drawing; offers every draft found for it. With `expected`, an item of the
   *  other kind is not opened: the store goes to its address instead (SPEC-DRAWINGS 6). */
  async open(id: string, expected?: Kind): Promise<void> {
    const g = ++generation;
    if (draftTimer) clearTimeout(draftTimer);
    Object.assign(s, blank(), { id, loading: true, editorId: drafts.newEditorId(), kind: expected ?? "note" });
    const noun = expected === "drawing" ? "drawing" : "note";
    try {
      const doc = await api().read(id);
      if (g !== generation) return;
      if (expected && doc.entry.kind !== expected) {
        s.wrongKind = true;
        void router.go(itemPath(doc.entry.kind, id), { replace: true, force: true });
        return;
      }
      adopt(doc);
      s.loading = false;
      s.offered = drafts.forNote(userId(), id, s.editorId, s.kind);
      if (s.mixed) toasts.push("This note mixes line endings. They will become LF when it is saved.", "warn");
    } catch (e) {
      if (g !== generation) return;
      s.loading = false;
      s.loadError = e instanceof ApiError ? (e.status === 410 ? `This ${noun} is in the trash.` : e.status === 404 ? `There is no such ${noun}.` : e.message) : `The ${noun} could not be opened.`;
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
      toasts.push(s.conflict.kind === "changed" ? `This ${what()} was changed elsewhere: choose Keep mine or Take theirs first.` : `This ${what()} is gone: use Save as a new ${what()} to keep your ${drawing() ? "drawing" : "text"}.`, "warn");
      return;
    }
    if (drawing()) {
      // A drawing is written only from a ready view of a file that could be read (4.3, 4.6).
      if (s.entry?.problem) {
        toasts.push("This drawing's file cannot be read, so it is not written.", "warn");
        return;
      }
      if (!viewReady()) {
        toasts.push("The drawing is still loading; nothing was saved.", "info");
        return;
      }
      return saveDrawing();
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

  /** For tests and the drawing screen: whether a save would send anything new. */
  get baseline(): string {
    return s.baseline;
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
    if (drawing()) return takeTheirsDrawing(doc, g);
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

  /** 4.7: offered when a save meets 410 or 404, and for a draft whose note is gone. A drawing's
   *  (SPEC-DRAWINGS 4.5): the open drawing sends its whole file; a draft (`kind` "drawing") sends
   *  the draft, and the server fills in the images the source has. */
  async saveAsNew(textOverride?: string, from?: string, kind?: Kind): Promise<string | null> {
    const own = textOverride === undefined;
    if (own) flushView();
    const k: Kind = own ? s.kind : (kind ?? "note");
    if (own && k === "drawing" && !viewReady()) {
      toasts.push("The drawing is still loading; try again in a moment.", "info");
      return null;
    }
    const noun = k === "drawing" ? "drawing" : "note";
    const t = textOverride ?? saveText();
    /** What a draft of the open item holds now, to compare after the request. */
    const draftNow = () => (k === "drawing" ? draftText() : serialize(text(), s.eol, s.bom));
    const sent = own ? draftNow() : t;
    const source = from ?? s.id ?? undefined;
    const g = generation;
    const id = s.id;
    const editorId = s.editorId;
    const uid = userId();
    try {
      const r = await api().saveAsNew(t, source, k);
      if (id && own) {
        const d = drafts.get(uid, id, editorId);
        // Text typed while the request was out goes with the new note as its draft, offered
        // when it opens; this editor's draft is removed only once nothing in it is lost.
        const now = g === generation ? draftNow() : (d?.text ?? sent);
        if (now === sent || drafts.put(uid, r.id, drafts.newEditorId(), now, r.revision, Date.now(), k)) {
          if (d) drafts.remove(d.key);
        }
        // The person goes on in the new item: leaving this one stores no draft of it.
        if (g === generation) {
          s.movedOn = true;
          if (draftTimer) clearTimeout(draftTimer);
          draftTimer = null;
        }
      }
      s.photosMissing = r.photosMissing;
      if (r.photosMissing) toasts.push(k === "drawing" ? "Saved as a new drawing. Some of its images could not be found, so they are missing." : "Saved as a new note. Its photos could not be found, so they are missing.", "warn", 8000);
      else toasts.push(`Saved as a new ${noun}.`, "info");
      void library.refresh();
      return r.id;
    } catch (e) {
      toasts.push(`Not saved: ${e instanceof Error ? e.message : `the ${noun} could not be made`}`, "error");
      return null;
    }
  },

  /** 9.5: opening a draft stores it under the current editor id, and takes its base revision. */
  async openDraft(d: Draft): Promise<void> {
    flushView();
    if (drawing()) return openDrawingDraft(d);
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

// --- a drawing (SPEC-DRAWINGS 4.3 to 4.5) ------------------------------------------------------

async function saveDrawing(): Promise<void> {
  const g = generation;
  const id = s.id!;
  const editorId = s.editorId;
  const uid = userId();
  const sc = scene();
  const bytes = serializeDrawing(sc, s.nook);
  const sig = signature(sc);
  const draftOfSaved = draftText(sc);
  s.saving = true;
  s.error = null;
  try {
    const r = await api().save(id, bytes, s.base, "drawing");
    // A late answer for a drawing the person has left only removes that editor's draft.
    drafts.removeIfSaved(uid, id, editorId, draftOfSaved);
    if (g !== generation) return;
    s.base = r.revision;
    s.saved = bytes;
    s.baseline = sig;
    s.entry = r.entry;
    s.saving = false;
    editor.changed();
    if (!unsavedNow()) {
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
    } else if (e instanceof ApiError && e.status === 413) {
      // 4.4: how large the drawing is, and that nothing was lost.
      const size = new TextEncoder().encode(bytes).length;
      s.error = `This drawing is ${(size / MB).toFixed(1)} MB; a drawing may be at most 25 MB. Nothing was lost: remove something from it (an image, say) and save again.`;
      toasts.push(`Not saved. ${s.error}`, "error", 12000);
    } else {
      s.error = e instanceof Error ? e.message : "The drawing could not be saved.";
      toasts.push(`Not saved: ${s.error}`, "error");
    }
  }
}

/** Take theirs: the person's scene is kept as a draft (4.5), then the newer file is loaded. */
async function takeTheirsDrawing(doc: NoteDoc, g: number): Promise<void> {
  const id = s.id!;
  const uid = userId();
  // Theirs must be a drawing, and the person's must be kept, before anything is replaced.
  if (!sceneOf(doc.text)) {
    toasts.push("The newer file cannot be read as a drawing, so it was not taken. Your drawing is kept: use Keep mine.", "error", 10000);
    return;
  }
  const mine = draftText();
  if (!drafts.put(uid, id, drafts.newEditorId(), mine, s.base, Date.now(), "drawing")) {
    toasts.push("Your drawing could not be kept as a draft (this browser refuses to store it), so theirs was not taken. Use Keep mine, or save your drawing to a file from Excalidraw's menu first.", "error", 12000);
    return;
  }
  const old = drafts.get(uid, id, s.editorId);
  if (old) drafts.remove(old.key);
  toasts.push("Your drawing was kept as a draft; it is offered the next time you open this drawing.", "info", 6000);
  adopt(doc);
  s.conflict = null;
  const sc = sceneOf(doc.text);
  if (view?.load && sc) await view.load(sc);
  if (g !== generation) return;
  s.baseline = signature();
  editor.changed();
}

/** Opening a draft: the scene from the draft, the image data from the file read from the server
 *  (4.5). The baseline is left alone, so the drawing is then unsaved. */
async function openDrawingDraft(d: Draft): Promise<void> {
  const draft = sceneOf(d.text);
  if (!draft) {
    toasts.push("This draft cannot be read.", "error");
    return;
  }
  if (unsavedNow()) {
    const g = generation;
    const ok = await toasts.confirm("Open this draft? It replaces what you drew since you opened the drawing; that is kept as a draft.", { ok: "Open the draft" });
    if (!ok || g !== generation) return;
    flushView();
    if (!drafts.put(userId(), s.id!, drafts.newEditorId(), draftText(), s.base, Date.now(), "drawing")) {
      toasts.push("Your drawing could not be kept as a draft (this browser refuses to store it), so the draft was not opened.", "error");
      return;
    }
  }
  if (!drafts.adopt(d, s.editorId)) return;
  const fromServer = sceneOf(s.saved)?.files ?? {};
  const files: Record<string, unknown> = {};
  let missing = 0;
  for (const f of usedFileIds(draft.elements)) {
    if (fromServer[f] !== undefined) files[f] = fromServer[f];
    else missing++;
  }
  // The draft's title and tags, where it has them (a draft Nook stores always does).
  const n = (parseDrawing(d.text).doc?.nook ?? {}) as { title?: unknown; tags?: unknown };
  const f = drawingFacts(d.text);
  s.nook = { ...s.nook, ...(typeof n.title === "string" && n.title.trim() !== "" ? { title: f.title } : {}), ...(Array.isArray(n.tags) ? { tags: f.tags } : {}) };
  s.base = d.base;
  s.offered = s.offered.filter((x) => x.key !== d.key);
  const g = generation;
  if (view?.load) await view.load({ elements: draft.elements, appState: draft.appState, files });
  if (g !== generation) return;
  if (missing) toasts.push(`${missing === 1 ? "One image" : `${missing} images`} added after the last save ${missing === 1 ? "is" : "are"} not in the draft, and ${missing === 1 ? "shows" : "show"} as a placeholder.`, "warn", 10000);
  editor.changed();
}
