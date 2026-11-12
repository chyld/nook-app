// SPEC2 6, fonts (version 1's fonts.ts): fonts from Google Fonts, copied to the server. Only the server talks to Google:
// the catalogue (Google's public font list, fonts.google.com/metadata/fonts, which needs no
// key), previews and font files (the CSS endpoint and the font file host).
//
// Fetching rules (section 5): only the three Google base addresses, over HTTPS, no redirects, at most 5 MB
// per download (10 MB for the catalogue), and at most 20 seconds per request. Tests give fake base addresses through
// test-only configuration (config.ts).

import { constants } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { LinkRefused, lstatOrNull, readdirOrEmpty, sfs as fs } from "./safefs.ts";
import path from "node:path";
import { LIMITS, RE, randomBase32 } from "../../contract/src/index.ts";
import type { Context } from "./context.ts";
import { HttpError } from "./errors.ts";
import { ensureDir, errCode, fsyncDir, isNotFound, readRegular, replaceFile } from "./fsutil.ts";
import type { UserSpace } from "./space.ts";

export const MAX_FONTS = LIMITS.fonts;
/** The catalogue is sent a page at a time. */
export const PAGE_SIZE = LIMITS.cataloguePage;
export const MAX_PAGE = 200;
export const MAX_DOWNLOAD = LIMITS.fontFetchBytes;
/** The font list (about 2.7 MB) is under the same 5 MB limit as every fetch (section 5). */
export const MAX_CATALOGUE = LIMITS.fontFetchBytes;
/** After a failed refresh of a list that exists, the next try waits this long. */
export const RETRY_AFTER_MS = 3600 * 1000;
export const FETCH_TIMEOUT_MS = LIMITS.fontFetchMs;
export const CATALOGUE_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
/** Google sends WOFF2 only to browsers that say they can read it. */
export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export interface Axis {
  tag: string;
  min: number;
  max: number;
}

export interface Family {
  family: string;
  slug: string;
  /** As Google names it: `Sans Serif`, `Serif`, `Display`, `Handwriting`, `Monospace`. */
  category: string;
  /** The keys of the list's `fonts` object: `400`, `400i`, `700`, `700i`, … */
  styles: string[];
  /** The variation axes; not empty for a variable font. */
  axes: Axis[];
  subsets: string[];
  /** Google's popularity rank: 1 is the most used. */
  popularity: number;
}

/** A category as a slug: `Sans Serif` → `sans-serif`. */
export function categoryKey(c: string): string {
  return c.toLowerCase().replace(/ /g, "-");
}

/**
 * Reads Google's font list. It is not a documented API, so its shape is checked: an object
 * with a non-empty `familyMetadataList`, whose entries have a `family` name and a `fonts`
 * object. Entries that do not have that shape are skipped; a list in which none does is an
 * error, and the caller keeps the list it has. Families with neither `latin` nor `latin-ext`
 * are skipped (DESIGN 1, 19).
 */
export function parseFontList(body: string): Family[] {
  // The answer may begin with the line `)]}'`, a guard against running it as script.
  const text = body.replace(/^\)\]\}'[^\n]*\n?/, "");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("the font list is not JSON");
  }
  const list = (data as { familyMetadataList?: unknown } | null)?.familyMetadataList;
  if (!Array.isArray(list) || list.length === 0) throw new Error("the font list has no families");
  const out: Family[] = [];
  let valid = 0;
  for (const raw of list) {
    const e = raw as { family?: unknown; category?: unknown; subsets?: unknown; fonts?: unknown; axes?: unknown; popularity?: unknown };
    if (typeof e?.family !== "string" || typeof e.fonts !== "object" || e.fonts === null || Array.isArray(e.fonts)) continue;
    valid++;
    const slug = slugOf(e.family);
    if (!isSlug(slug)) continue;
    const subsets = Array.isArray(e.subsets) ? e.subsets.filter((x): x is string => typeof x === "string") : [];
    if (!subsets.includes("latin") && !subsets.includes("latin-ext")) continue;
    const styles = Object.keys(e.fonts).filter((k) => /^[1-9]00i?$/.test(k));
    if (styles.length === 0) continue;
    const axes: Axis[] = [];
    if (Array.isArray(e.axes)) {
      for (const a of e.axes as { tag?: unknown; min?: unknown; max?: unknown; minValue?: unknown; maxValue?: unknown }[]) {
        const min = typeof a?.min === "number" ? a.min : a?.minValue;
        const max = typeof a?.max === "number" ? a.max : a?.maxValue;
        if (typeof a?.tag === "string" && typeof min === "number" && typeof max === "number" && min <= max) axes.push({ tag: a.tag, min, max });
      }
    }
    out.push({
      family: e.family,
      slug,
      category: typeof e.category === "string" ? e.category : "",
      styles,
      axes,
      subsets,
      popularity: typeof e.popularity === "number" && Number.isFinite(e.popularity) ? e.popularity : Number.MAX_SAFE_INTEGER,
    });
  }
  if (valid === 0) throw new Error("no entry of the font list has the expected shape");
  // Most popular first (DESIGN 10: the screen's default order), then by name.
  out.sort((a, b) => a.popularity - b.popularity || a.family.localeCompare(b.family));
  return out;
}

/** DESIGN 10: the family's name in lower case with spaces as hyphens. */
export function slugOf(family: string): string {
  return family.toLowerCase().replace(/ /g, "-");
}

export function isSlug(s: unknown): s is string {
  return typeof s === "string" && RE.fontSlug.test(s);
}

/** True for WOFF2 data. */
function isWoff2(b: Uint8Array): boolean {
  return b.length >= 4 && b[0] === 0x77 && b[1] === 0x4f && b[2] === 0x46 && b[3] === 0x32; // "wOF2"
}

/** The @font-face blocks of a Google CSS answer, each with the subset named in the comment before it. */
export function fontFaceBlocks(css: string): { subset: string | null; body: string }[] {
  const out: { subset: string | null; body: string }[] = [];
  const re = /(?:\/\*\s*([a-z0-9-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g;
  for (const m of css.matchAll(re)) out.push({ subset: m[1] ?? null, body: m[2] });
  return out;
}

/**
 * The `family=` value of the CSS request. A variable font (a `wght` axis) is asked for over
 * its whole weight range, upright and, if it has italics, italic: one file per subset and
 * style. Otherwise regular, bold, italic and bold italic, of those the family has; a family
 * with none of them gets its weight nearest to 400.
 */
export function stylesQuery(f: Family): string {
  const name = encodeURIComponent(f.family).replace(/%20/g, "+");
  const has = new Set(f.styles);
  const italic = f.styles.some((k) => k.endsWith("i"));
  const wght = f.axes.find((a) => a.tag === "wght");
  if (wght) {
    const range = wght.min === wght.max ? `${wght.min}` : `${wght.min}..${wght.max}`;
    return italic ? `${name}:ital,wght@0,${range};1,${range}` : `${name}:wght@${range}`;
  }
  const want: [number, number][] = [];
  if (has.has("400")) want.push([0, 400]);
  if (has.has("700")) want.push([0, 700]);
  if (has.has("400i")) want.push([1, 400]);
  if (has.has("700i")) want.push([1, 700]);
  if (want.length === 0) {
    const pick = [...f.styles].sort((a, b) => Math.abs(parseInt(a) - 400) - Math.abs(parseInt(b) - 400) || (a.endsWith("i") ? 1 : -1))[0];
    want.push([pick.endsWith("i") ? 1 : 0, parseInt(pick)]);
  }
  want.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (want.every(([i]) => i === 0)) return `${name}:wght@${want.map(([, w]) => w).join(";")}`;
  return `${name}:ital,wght@${want.map(([i, w]) => `${i},${w}`).join(";")}`;
}

export class Fonts {
  readonly ctx: Context;
  #catalogue: { version: 2; fetched: number; families: Family[] } | null = null;
  #loading: Promise<void> | null = null;
  readonly #origins: Set<string>;

  constructor(ctx: Context) {
    this.ctx = ctx;
    const g = ctx.config.google;
    this.#origins = new Set([g.list, g.css, g.files].map((u) => new URL(u).origin));
  }

  // --- fetching ------------------------------------------------------------------------------

  /** Fetches under the rules of DESIGN 10; returns the body, at most `max` bytes (5 MB). */
  async fetchLimited(url: string, accept: string, max = MAX_DOWNLOAD): Promise<Buffer> {
    const u = new URL(url);
    const secure = u.protocol === "https:" || (this.ctx.config.googleInsecure && u.protocol === "http:");
    if (!secure || !this.#origins.has(u.origin)) throw new HttpError(502, "A font address is not one of Google's.");
    let res: Response;
    const signal = AbortSignal.timeout(this.ctx.config.fontFetchMs ?? FETCH_TIMEOUT_MS);
    try {
      res = await fetch(u, { redirect: "manual", signal, headers: { "user-agent": BROWSER_UA, accept } });
    } catch {
      throw new HttpError(504, "Google Fonts did not answer in time.");
    }
    if (res.status >= 300 && res.status < 400) throw new HttpError(502, "Google Fonts answered with a redirect, which is not followed.");
    if (!res.ok) throw new HttpError(502, `Google Fonts answered ${res.status}.`);
    const declared = Number(res.headers.get("content-length") ?? "0");
    const tooBig = `A download from Google Fonts is larger than ${max / 1024 / 1024} MB.`;
    if (declared > max) throw new HttpError(502, tooBig);
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        total += chunk.length;
        if (total > max) throw new HttpError(502, tooBig);
        chunks.push(chunk);
      }
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(504, "Google Fonts did not answer in time.");
    }
    return Buffer.concat(chunks);
  }

  // --- the catalogue -------------------------------------------------------------------------

  #failedAt = 0;

  /**
   * The catalogue: from memory, else from cache/google-fonts.json, refreshed from Google when
   * it is more than a week old. A failed refresh keeps the list there is (and is not tried
   * again for an hour); with no list at all the answer is 503, and every request tries again.
   */
  async catalogue(): Promise<Family[]> {
    if (!this.#catalogue) {
      const bytes = await readRegular(this.ctx.layout.catalogue);
      if (bytes) {
        try {
          const c = JSON.parse(bytes.toString("utf8"));
          if (c?.version === 2 && Array.isArray(c.families)) this.#catalogue = c;
        } catch {
          this.#catalogue = null;
        }
      }
    }
    const stale = !this.#catalogue || Date.now() - this.#catalogue.fetched > CATALOGUE_MAX_AGE_MS;
    const waiting = this.#catalogue !== null && Date.now() - this.#failedAt < RETRY_AFTER_MS;
    if (stale && !waiting) {
      this.#loading ??= this.#refresh().finally(() => (this.#loading = null));
      try {
        await this.#loading;
      } catch (e) {
        this.#failedAt = Date.now();
        this.ctx.log.error(`fonts: the font list could not be fetched (${e instanceof HttpError ? e.status : (e as Error).message})`);
        // A stale catalogue is better than none.
        if (!this.#catalogue) throw new HttpError(503, "The list of Google Fonts could not be fetched.");
      }
    }
    return this.#catalogue!.families;
  }

  async #refresh(): Promise<void> {
    const g = this.ctx.config.google;
    const body = await this.fetchLimited(`${g.list}/metadata/fonts`, "application/json", MAX_CATALOGUE);
    const families = parseFontList(body.toString("utf8"));
    const c = { version: 2 as const, fetched: Date.now(), families };
    await ensureDir(this.ctx.layout.cacheTmp);
    await replaceFile(this.ctx.layout.cacheTmp, this.ctx.layout.catalogue, Buffer.from(JSON.stringify(c)));
    this.#catalogue = c;
    this.#failedAt = 0;
  }

  async family(slug: unknown): Promise<Family> {
    if (!isSlug(slug)) throw new HttpError(404, "There is no such font family.");
    const f = (await this.catalogue()).find((x) => x.slug === slug);
    if (!f) throw new HttpError(404, "There is no such font family.");
    return f;
  }

  /** A page of the families matching a name and category, and how many match in all. */
  async search(q: string, category: string, offset = 0, limit = PAGE_SIZE): Promise<{ families: Family[]; total: number }> {
    const needle = q.trim().toLowerCase();
    const cat = categoryKey(category);
    const all = (await this.catalogue()).filter((f) => (!needle || f.family.toLowerCase().includes(needle)) && (!cat || categoryKey(f.category) === cat));
    return { families: all.slice(offset, offset + limit), total: all.length };
  }

  // --- previews ------------------------------------------------------------------------------

  /** A font holding only the letters of the family's name, cached for everyone. */
  async preview(slug: unknown): Promise<Buffer> {
    const f = await this.family(slug);
    const file = path.join(this.ctx.layout.previews, `${f.slug}.woff2`);
    const cached = await readRegular(file);
    if (cached && isWoff2(cached)) return cached;
    const g = this.ctx.config.google;
    const name = encodeURIComponent(f.family).replace(/%20/g, "+");
    const css = (await this.fetchLimited(`${g.css}/css2?family=${name}&text=${encodeURIComponent(f.family)}`, "text/css")).toString("utf8");
    const src = /url\(([^)]+)\)\s*format\(['"]woff2['"]\)/.exec(css)?.[1]?.replace(/^['"]|['"]$/g, "");
    if (!src) throw new HttpError(502, "Google Fonts sent no preview.");
    const data = await this.fetchLimited(src, "font/woff2,*/*");
    if (!isWoff2(data)) throw new HttpError(502, "Google Fonts sent something that is not a WOFF2 font.");
    await ensureDir(this.ctx.layout.previews);
    await replaceFile(this.ctx.layout.cacheTmp, file, data);
    return data;
  }

  // --- a person's fonts ----------------------------------------------------------------------

  /** Under the user's lock. */
  async installed(space: UserSpace): Promise<{ family: string; slug: string }[]> {
    const out: { family: string; slug: string }[] = [];
    const names = await readdirOrEmpty(space.layout.fonts);
    for (const slug of names.sort()) {
      if (!isSlug(slug)) continue;
      // A font folder replaced by a symbolic link is refused (DESIGN 12) and left out.
      const css = await readRegular(path.join(space.layout.fontDir(slug), "font.css")).catch((e) => {
        if (e instanceof LinkRefused) return null;
        throw e;
      });
      if (!css) continue;
      const family = /font-family:\s*'([^']*)'/.exec(css.toString("utf8"))?.[1] ?? slug;
      out.push({ family, slug });
    }
    return out;
  }

  /**
   * Adding a font. Without the lock: ask the CSS endpoint for the family's styles in WOFF2, keep
   * the latin and latin-ext blocks, download those files and write them with a font.css into a
   * folder in tmp/. Then, under the lock, rename that folder into fonts/.
   */
  async add(space: UserSpace, slug: unknown): Promise<{ family: string; slug: string }> {
    const f = await this.family(slug);
    await space.lock.run(async () => {
      if (await lstatOrNull(space.layout.fontDir(f.slug))) throw new HttpError(409, "This font is already added.");
      if ((await this.installed(space)).length >= MAX_FONTS) throw new HttpError(409, `At most ${MAX_FONTS} fonts can be added.`);
    });
    const g = this.ctx.config.google;
    const css = (await this.fetchLimited(`${g.css}/css2?${`family=${stylesQuery(f)}`}&display=swap`, "text/css")).toString("utf8");
    const blocks = fontFaceBlocks(css).filter((b) => b.subset === "latin" || b.subset === "latin-ext");
    if (blocks.length === 0) throw new HttpError(502, "Google Fonts sent no Latin font files for this family.");
    const build = path.join(space.layout.tmp, `font-${Date.now()}-${randomBase32(8)}`);
    await fs.mkdir(build, { mode: 0o700 });
    try {
      const files = new Map<string, string>();
      let out = `/* ${f.family}, from Google Fonts (latin and latin-ext). */\n`;
      for (const b of blocks) {
        // Only the declarations a font face needs; everything else is dropped first.
        const keep = b.body
          .split(";")
          .map((d) => d.trim())
          .filter((d) => /^(font-family|font-style|font-weight|font-stretch|font-display|src|unicode-range)\s*:/.test(d));
        const decls: string[] = [];
        for (let d of keep) {
          if (d.startsWith("src")) {
            const urls = [...d.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/^['"]|['"]$/g, ""));
            for (const u of urls) {
              let local = files.get(u);
              if (!local) {
                local = `${files.size + 1}.woff2`;
                const data = await this.fetchLimited(u, "font/woff2,*/*");
                if (!isWoff2(data)) throw new HttpError(502, "Google Fonts sent something that is not a WOFF2 font.");
                await fs.writeFile(path.join(build, local), data, { mode: 0o600 });
                files.set(u, local);
              }
              d = d.split(u).join(`/api/fonts/${f.slug}/${local}`);
            }
          }
          decls.push(d);
        }
        out += `/* ${b.subset} */\n@font-face {\n  ${decls.join(";\n  ")};\n}\n`;
      }
      await fs.writeFile(path.join(build, "font.css"), out, { mode: 0o600 });
      for (const name of await fs.readdir(build)) {
        const fh = await fs.open(path.join(build, name), constants.O_RDONLY | constants.O_NOFOLLOW);
        await fh.sync();
        await fh.close();
      }
      await fsyncDir(build);
      return await space.lock.run(async () => {
        if ((await this.installed(space)).length >= MAX_FONTS) throw new HttpError(409, `At most ${MAX_FONTS} fonts can be added.`);
        try {
          await fs.rename(build, space.layout.fontDir(f.slug));
        } catch (e) {
          if (errCode(e) === "ENOTEMPTY" || errCode(e) === "EEXIST") throw new HttpError(409, "This font is already added.");
          throw e;
        }
        await fsyncDir(space.layout.fonts);
        await fsyncDir(space.layout.tmp);
        return { family: f.family, slug: f.slug };
      });
    } finally {
      await fs.rm(build, { recursive: true, force: true });
    }
  }

  /** Removing a font deletes its folder (moved to tmp/ first, so it goes at once). */
  async remove(space: UserSpace, slug: unknown): Promise<void> {
    if (!isSlug(slug)) throw new HttpError(404, "There is no such font.");
    const gone = path.join(space.layout.tmp, `font-removed-${randomBase32(8)}`);
    await space.lock.run(async () => {
      try {
        await fs.rename(space.layout.fontDir(slug), gone);
      } catch (e) {
        if (isNotFound(e)) throw new HttpError(404, "There is no such font.");
        throw e;
      }
      await fsyncDir(space.layout.fonts);
    });
    await fs.rm(gone, { recursive: true, force: true });
  }

  /** /api/fonts.css: the person's font.css files joined together. */
  async css(space: UserSpace): Promise<string> {
    return space.lock.run(async () => {
      let out = "";
      for (const { slug } of await this.installed(space)) {
        const css = await readRegular(path.join(space.layout.fontDir(slug), "font.css"));
        if (css) out += css.toString("utf8") + "\n";
      }
      return out;
    });
  }

  /** Opens one of the person's font files under the lock; it is sent after the lock is released. */
  async open(space: UserSpace, slug: unknown, file: unknown): Promise<{ fh: FileHandle; size: number }> {
    if (!isSlug(slug) || typeof file !== "string" || !/^[0-9]{1,4}\.woff2$/.test(file)) throw new HttpError(404, "There is no such font file.");
    return space.lock.run(async () => {
      const dir = space.layout.fontDir(slug);
      const dst = await lstatOrNull(dir);
      if (!dst?.isDirectory()) throw new HttpError(404, "There is no such font file.");
      let fh: FileHandle;
      try {
        fh = await fs.open(path.join(dir, file), constants.O_RDONLY | constants.O_NOFOLLOW);
      } catch (e) {
        if (isNotFound(e) || errCode(e) === "ELOOP") throw new HttpError(404, "There is no such font file.");
        throw e;
      }
      const st = await fh.stat();
      const head = Buffer.alloc(4);
      await fh.read(head, 0, 4, 0);
      if (!st.isFile() || !isWoff2(head)) {
        await fh.close();
        throw new HttpError(404, "There is no such font file.");
      }
      return { fh, size: st.size };
    });
  }
}
