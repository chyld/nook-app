// SPEC2 9.2: the list of notes, tag counts, the search text and tag filter.

import type { Entry, HistoryEntry, TagCount, TrashEntry } from "../../../contract/src/index.ts";
import { api, ApiError } from "../lib/api.ts";

const s = $state({ entries: [] as Entry[], tags: [] as TagCount[], search: "", tag: "", loaded: false, error: null as string | null, trash: [] as TrashEntry[], trashLoaded: false, versions: [] as HistoryEntry[], versionsOf: "", picked: null as string | null, pickedText: null as string | null, looked: {} as Record<string, Entry | "gone"> });
let timer: ReturnType<typeof setTimeout> | null = null;
let asked = 0;

export const library = {
  get entries(): readonly Entry[] {
    return s.entries;
  },
  get tags(): readonly TagCount[] {
    return s.tags;
  },
  get search(): string {
    return s.search;
  },
  get tag(): string {
    return s.tag;
  },
  get loaded(): boolean {
    return s.loaded;
  },
  get error(): string | null {
    return s.error;
  },
  async refresh(): Promise<void> {
    const n = ++asked;
    try {
      const r = await api().list({ q: s.search.trim() || undefined, tag: s.tag || undefined });
      if (n !== asked) return;
      s.entries = r.entries;
      s.tags = r.tags;
      s.looked = {};
      s.loaded = true;
      s.error = null;
    } catch (e) {
      if (n !== asked) return;
      s.error = e instanceof Error ? e.message : "The notes could not be listed.";
    }
  },
  /** Search acts in place, a moment after typing stops. */
  /**
   * Whether a note is live, for a draft on the home screen: the list says so when it is not
   * narrowed by a search or a tag; otherwise a note missing from it is looked up (`lookup`).
   */
  noteStatus(id: string): "live" | "gone" | "unknown" {
    if (s.entries.some((e) => e.id === id)) return "live";
    const l = s.looked[id];
    if (l) return l === "gone" ? "gone" : "live";
    if (s.loaded && !s.search.trim() && !s.tag) return "gone";
    return "unknown";
  },
  /** The title of a note, from the list or a lookup. */
  titleOf(id: string): string | null {
    const e = s.entries.find((x) => x.id === id) ?? s.looked[id];
    return e && e !== "gone" ? e.title : null;
  },
  /** Asks the server whether a note the narrowed list does not show is live. */
  async lookup(id: string): Promise<void> {
    try {
      s.looked = { ...s.looked, [id]: (await api().read(id)).entry };
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 410)) s.looked = { ...s.looked, [id]: "gone" };
    }
  },
  setSearch(q: string): void {
    s.search = q;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void library.refresh(), 200);
  },
  setTag(tag: string): void {
    s.tag = s.tag === tag ? "" : tag;
    void library.refresh();
  },
  async create(title?: string): Promise<string> {
    const r = await api().create(title);
    await library.refresh();
    return r.id;
  },
  async trash(id: string): Promise<void> {
    await api().trash(id);
    await library.refresh();
  },
  reset(): void {
    Object.assign(s, { entries: [], tags: [], search: "", tag: "", loaded: false, error: null, trash: [], trashLoaded: false, versions: [], versionsOf: "", picked: null, pickedText: null, looked: {} });
  },

  // --- the trash (4.3) ---
  get trashed(): readonly TrashEntry[] {
    return s.trash;
  },
  get trashLoaded(): boolean {
    return s.trashLoaded;
  },
  async loadTrash(): Promise<void> {
    s.trash = (await api().trashList()).entries;
    s.trashLoaded = true;
  },
  async readTrashed(id: string): Promise<string> {
    return (await api().trashRead(id)).text;
  },
  async restore(id: string): Promise<void> {
    await api().restore(id);
    await Promise.all([library.loadTrash(), library.refresh()]);
  },
  async empty(ids: string[]): Promise<void> {
    await api().empty(ids);
    await library.loadTrash();
  },

  // --- history (4.6) ---
  get versions(): readonly HistoryEntry[] {
    return s.versions;
  },
  get versionsOf(): string {
    return s.versionsOf;
  },
  async loadHistory(id: string): Promise<void> {
    Object.assign(s, { picked: null, pickedText: null });
    s.versionsOf = id;
    s.versions = (await api().history(id)).versions;
  },
  async readVersion(id: string, version: string): Promise<string> {
    return (await api().version(id, version)).text;
  },
  /** The version picked on the history screen, and its text once it has been read (null until
   *  then, or when the read failed): only the answer for the version picked last is kept. */
  get picked(): string | null {
    return s.picked;
  },
  get pickedText(): string | null {
    return s.pickedText;
  },
  async pickVersion(id: string, version: string): Promise<void> {
    s.picked = version;
    s.pickedText = null;
    try {
      const text = await library.readVersion(id, version);
      if (s.picked === version && s.versionsOf === id) s.pickedText = text;
    } catch (e) {
      if (s.picked === version) s.picked = null;
      throw e;
    }
  },
  /** A restore is an ordinary save: the note's current revision, then the old text with it. */
  async restoreVersion(id: string, text: string): Promise<void> {
    const now = await api().read(id);
    await api().save(id, text, now.revision);
    await Promise.all([library.loadHistory(id), library.refresh()]);
  },
};
