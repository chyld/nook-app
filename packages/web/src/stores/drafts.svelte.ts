// SPEC2 9.5: unsaved text in local storage, under user id, note id and a random editor id made
// when the editor opened; it holds the text, the base revision, the time and the kind (a note's
// text, or a drawing's file without its images: SPEC-DRAWINGS 4.5; a draft stored without a
// kind is a note's). A draft never
// expires by age. If the browser refuses a write (storage is full), a warning stays on screen
// until a write succeeds.

import { randomBase32, type Kind } from "../../../contract/src/index.ts";

export interface Draft {
  key: string;
  userId: string;
  noteId: string;
  editorId: string;
  text: string;
  base: string;
  time: number;
  kind: Kind;
}

export interface StorageLike {
  readonly length: number;
  key(i: number): string | null;
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const PREFIX = "notes:draft:";

let storage: StorageLike | null = null;
function store(): StorageLike | null {
  if (storage) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const state = $state({ full: false, version: 0 });

const keyOf = (userId: string, noteId: string, editorId: string) => `${PREFIX}${userId}:${noteId}:${editorId}`;

function parse(key: string, raw: string | null): Draft | null {
  if (!raw || !key.startsWith(PREFIX)) return null;
  const [userId, noteId, editorId] = key.slice(PREFIX.length).split(":");
  if (!userId || !noteId || !editorId) return null;
  try {
    const v = JSON.parse(raw) as { text?: unknown; base?: unknown; time?: unknown; kind?: unknown };
    if (typeof v.text !== "string" || typeof v.base !== "string" || typeof v.time !== "number") return null;
    return { key, userId, noteId, editorId, text: v.text, base: v.base, time: v.time, kind: v.kind === "drawing" ? "drawing" : "note" };
  } catch {
    return null;
  }
}

let channel: BroadcastChannel | null = null;
const logoutListeners = new Set<() => void>();
function chan(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === "undefined") return channel;
  channel = new BroadcastChannel("notes");
  // In Node (the store tests) an open channel would keep the process alive.
  (channel as unknown as { unref?: () => void }).unref?.();
  channel.onmessage = (e) => {
    if ((e.data as { type?: string })?.type === "logout") for (const f of logoutListeners) f();
  };
  return channel;
}

export const drafts = {
  /** For tests: a storage to use instead of localStorage. */
  useStorage(s: StorageLike | null): void {
    storage = s;
  },
  newEditorId(): string {
    return randomBase32(16);
  },
  /** True while the browser refuses to keep drafts. */
  get full(): boolean {
    return state.full;
  },
  /** Changes whenever a draft is written or removed, for screens that list them. */
  get version(): number {
    return state.version;
  },
  put(userId: string, noteId: string, editorId: string, text: string, base: string, time = Date.now(), kind: Kind = "note"): boolean {
    const s = store();
    if (!s) {
      // No storage at all (turned off, or refused by the browser): the same warning as full.
      state.full = true;
      return false;
    }
    try {
      s.setItem(keyOf(userId, noteId, editorId), JSON.stringify(kind === "note" ? { text, base, time } : { text, base, time, kind }));
      state.full = false;
      state.version++;
      return true;
    } catch {
      state.full = true;
      return false;
    }
  },
  get(userId: string, noteId: string, editorId: string): Draft | null {
    const k = keyOf(userId, noteId, editorId);
    return parse(k, store()?.getItem(k) ?? null);
  },
  remove(key: string): void {
    store()?.removeItem(key);
    state.version++;
  },
  /** After a save: the draft is removed only if its text is what was saved. */
  removeIfSaved(userId: string, noteId: string, editorId: string, saved: string): void {
    const d = drafts.get(userId, noteId, editorId);
    if (d && d.text === saved) drafts.remove(d.key);
  },
  list(userId: string): Draft[] {
    const s = store();
    if (!s) return [];
    const out: Draft[] = [];
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith(`${PREFIX}${userId}:`)) keys.push(k);
    }
    for (const k of keys) {
      const d = parse(k, s.getItem(k));
      if (d) out.push(d);
    }
    return out.sort((a, b) => b.time - a.time);
  },
  /** Every draft for a note (or a drawing: `kind`) but the current editor's own. */
  forNote(userId: string, noteId: string, exceptEditor: string, kind: Kind = "note"): Draft[] {
    return drafts.list(userId).filter((d) => d.noteId === noteId && d.editorId !== exceptEditor && d.kind === kind);
  },
  /** Opening a draft stores it under the current editor id before the old entry is removed. */
  adopt(d: Draft, editorId: string): boolean {
    if (!drafts.put(d.userId, d.noteId, editorId, d.text, d.base, d.time, d.kind)) return false;
    if (d.editorId !== editorId) drafts.remove(d.key);
    return true;
  },
  /** Logout removes the user's drafts and tells the browser's other tabs. */
  removeAll(userId: string, tellOthers = false): void {
    for (const d of drafts.list(userId)) store()?.removeItem(d.key);
    state.version++;
    if (tellOthers) chan()?.postMessage({ type: "logout" });
  },
  listenForLogout(f: () => void): void {
    chan();
    logoutListeners.add(f);
  },
};
