// SPEC2 9.2: the person's fonts, as the server holds them, and the catalogue being browsed.

import type { CatalogueFamily, Font } from "../../../contract/src/index.ts";
import { api } from "../lib/api.ts";

const s = $state({
  mine: [] as Font[],
  loaded: false,
  families: [] as CatalogueFamily[],
  total: 0,
  categories: [] as string[],
  available: true,
  q: "",
  category: "",
  browsing: false,
  busy: "" as string,
  version: 0,
});

/** Bumped by every search, so a late answer to an older one changes nothing. */
let asked = 0;

export const fonts = {
  get mine(): readonly Font[] {
    return s.mine;
  },
  get loaded(): boolean {
    return s.loaded;
  },
  get families(): readonly CatalogueFamily[] {
    return s.families;
  },
  get total(): number {
    return s.total;
  },
  get categories(): readonly string[] {
    return s.categories;
  },
  get available(): boolean {
    return s.available;
  },
  get q(): string {
    return s.q;
  },
  get category(): string {
    return s.category;
  },
  get browsing(): boolean {
    return s.browsing;
  },
  /** The slug being added or removed. */
  get busy(): string {
    return s.busy;
  },
  /** Changes when the person's fonts change, so the page reloads /api/fonts.css. */
  get version(): number {
    return s.version;
  },
  async load(): Promise<void> {
    s.mine = (await api().fonts()).fonts;
    s.loaded = true;
  },
  async browse(q = s.q, category = s.category): Promise<void> {
    s.q = q;
    s.category = category;
    s.browsing = true;
    // Only the answer to the latest search is kept; an older one arriving late is dropped.
    const n = ++asked;
    try {
      const r = await api().catalogue({ q: q || undefined, category: category || undefined, offset: 0 });
      if (n !== asked) return;
      s.families = r.families;
      s.total = r.total;
      s.categories = r.categories;
      s.available = r.available;
    } finally {
      if (n === asked) s.browsing = false;
    }
  },
  /** "Show more": the next page, kept only if no other search was asked for meanwhile. Gives
   *  how many families it added (0 also when a newer search took its place). */
  async more(): Promise<number> {
    const n = asked;
    const r = await api().catalogue({ q: s.q || undefined, category: s.category || undefined, offset: s.families.length });
    if (n !== asked) return 0;
    const had = new Set(s.families.map((f) => f.slug));
    const added = r.families.filter((f) => !had.has(f.slug));
    s.families = [...s.families, ...added];
    s.total = r.total;
    return added.length;
  },
  async add(slug: string): Promise<void> {
    s.busy = slug;
    try {
      s.mine = (await api().fontAdd(slug)).fonts;
      s.version++;
    } finally {
      s.busy = "";
    }
  },
  async remove(slug: string): Promise<void> {
    s.busy = slug;
    try {
      s.mine = (await api().fontRemove(slug)).fonts;
      s.version++;
    } finally {
      s.busy = "";
    }
  },
};
