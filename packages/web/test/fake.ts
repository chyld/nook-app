// A fake API client for the store tests (SPEC2 12): notes in memory, revisions of the bytes,
// and hooks to hold an answer back or to change a note "elsewhere".

import { createHash } from "node:crypto";
import type { ApiClient } from "../src/lib/api.ts";
import { ApiError } from "../src/lib/api.ts";
import type { Entry } from "../../contract/src/index.ts";

const rev = (t: string) => createHash("sha256").update(Buffer.from(t, "utf8")).digest("hex");

export class FakeApi {
  notes = new Map<string, { text: string; trashed: boolean }>();
  saves: { id: string; text: string; base: string }[] = [];
  /** Saves wait for this before they answer, when set. */
  gate: Promise<void> | null = null;
  next = 1;

  entry(id: string): Entry {
    return { id, title: "T", tags: [], created: null, modified: Date.now(), size: this.notes.get(id)?.text.length ?? 0 };
  }

  add(text: string): string {
    const id = String(this.next++).padStart(24, "a").replace(/[^a-z2-7]/g, "b");
    this.notes.set(id, { text, trashed: false });
    return id;
  }

  client(): ApiClient {
    const nope = () => Promise.reject(new Error("not in the fake"));
    return {
      login: async (username) => ({ user: { id: "uuuuuuuuuuuuuuuu", username } }),
      logout: async () => ({}),
      me: async () => ({ user: { id: "uuuuuuuuuuuuuuuu", username: "alice" }, lastBackup: null }),
      password: async () => ({}),
      list: async () => ({ entries: [...this.notes.keys()].map((id) => this.entry(id)), tags: [] }),
      create: nope,
      saveAsNew: async (text) => {
        const id = this.add(text);
        return { id, revision: rev(text), entry: this.entry(id), text, photosMissing: false };
      },
      read: async (id) => {
        const n = this.notes.get(id);
        if (!n) throw new ApiError(404, "not-found", "There is no such note.");
        if (n.trashed) throw new ApiError(410, "trashed", "In the trash.");
        return { text: n.text, revision: rev(n.text), entry: this.entry(id) };
      },
      save: async (id, text, base) => {
        this.saves.push({ id, text, base });
        if (this.gate) await this.gate;
        const n = this.notes.get(id);
        if (!n) throw new ApiError(404, "not-found", "There is no such note.");
        if (n.trashed) throw new ApiError(410, "trashed", "In the trash.");
        if (rev(n.text) !== base) throw new ApiError(409, "changed", "Changed.", { current: { text: n.text, revision: rev(n.text), entry: this.entry(id) } });
        n.text = text;
        return { revision: rev(text), entry: this.entry(id) };
      },
      trash: nope,
      history: nope,
      version: nope,
      upload: nope,
      trashList: nope,
      trashRead: nope,
      restore: nope,
      empty: nope,
      styles: async () => ({ styles: [] }),
      styleSave: nope,
      styleDelete: nope,
      catalogue: nope,
      fonts: async () => ({ fonts: [] }),
      fontAdd: nope,
      fontRemove: nope,
    };
  }
}

export { rev };

/** A localStorage that can be made full. */
export class FakeStorage {
  map = new Map<string, string>();
  full = false;
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.full) throw new Error("QuotaExceededError");
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}
