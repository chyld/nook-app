// SPEC2 6, saved styles: `styles.json` holds at most 50 styles. `PUT /api/styles/:name` takes
// `{ style, renameFrom? }` and saves, replaces or renames in one step under the lock.

import { LIMITS, type Style } from "../../contract/src/index.ts";
import { HttpError } from "./errors.ts";
import { readRegular, replaceFile } from "./fsutil.ts";
import type { UserSpace } from "./space.ts";

const COLOUR = /^(#[0-9a-fA-F]{3,8}|[a-z]{1,20})$/;
const FONT = /^[\p{L}\p{N} .'_-]{1,100}$/u;

export function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

/** A style, checked field by field. */
export function cleanStyle(name: string, o: Style): Style {
  const n = cleanName(name);
  if (n === "" || [...n].length > LIMITS.styleName) throw new HttpError(400, "A style needs a name of 1 to 40 characters.");
  const text = (x: string | null, re: RegExp): string | null => {
    if (x === null || x === "") return null;
    if (!re.test(x)) throw new HttpError(400, "That style cannot be saved.");
    return x;
  };
  return {
    name: n,
    bold: o.bold,
    italic: o.italic,
    underline: o.underline,
    strike: o.strike,
    size: o.size === null ? null : Math.round(o.size * 10) / 10,
    font: text(o.font, FONT),
    color: text(o.color, COLOUR),
    bg: text(o.bg, COLOUR),
  };
}

const same = (a: string, b: string) => cleanName(a).toLowerCase() === cleanName(b).toLowerCase();

/** One entry of styles.json as written, and the style it is when it checks. */
interface Entry {
  raw: unknown;
  style: Style | null;
}

function checked(s: unknown): Style | null {
  try {
    if (!s || typeof s !== "object" || typeof (s as Style).name !== "string") return null;
    const o = s as Style;
    return cleanStyle(o.name, { ...o, size: o.size ?? null, font: o.font ?? null, color: o.color ?? null, bg: o.bg ?? null, bold: !!o.bold, italic: !!o.italic, underline: !!o.underline, strike: !!o.strike });
  } catch {
    return null;
  }
}

/**
 * styles.json as it is on disk, entry by entry; null when there is a file that is not a JSON
 * list. An entry that does not check, and every entry past the 50th that does, is not shown but
 * is written back as it was (a file edited by hand loses nothing; review, 35d).
 */
async function readEntries(space: UserSpace): Promise<Entry[] | null> {
  const data = await readRegular(space.layout.styles);
  if (!data) return [];
  let list: unknown;
  try {
    list = JSON.parse(data.toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;
  let shown = 0;
  return list.map((raw) => {
    const style = shown < LIMITS.styles ? checked(raw) : null;
    if (style) shown++;
    return { raw, style };
  });
}

/** For a change: the entries, or a refusal when the file cannot be read as a list. */
async function entriesToChange(space: UserSpace): Promise<Entry[]> {
  const e = await readEntries(space);
  if (e === null) throw new HttpError(409, "styles.json cannot be read, so it is left as it is; fix it by hand.", {}, "damaged");
  return e;
}

const shownOf = (e: Entry[]): Style[] => e.flatMap((x) => (x.style ? [x.style] : []));

/** Under the user's lock. */
export async function readStyles(space: UserSpace): Promise<Style[]> {
  return shownOf((await readEntries(space)) ?? []);
}

async function writeStyles(space: UserSpace, entries: Entry[]): Promise<void> {
  const list = entries.map((x) => x.style ?? x.raw);
  await replaceFile(space.layout.tmp, space.layout.styles, Buffer.from(JSON.stringify(list, null, 2) + "\n", "utf8"));
}

/** Saves, replaces or renames, under the user's lock. */
export async function putStyle(space: UserSpace, name: string, style: Style, renameFrom?: string): Promise<Style[]> {
  const s = cleanStyle(name, style);
  const entries = await entriesToChange(space);
  const at = entries.findIndex((x) => x.style && same(x.style.name, s.name));
  if (renameFrom !== undefined && !same(renameFrom, s.name)) {
    const from = entries.findIndex((x) => x.style && same(x.style.name, renameFrom));
    if (from < 0) throw new HttpError(404, "There is no such style.");
    if (at >= 0) throw new HttpError(409, "A style with this name exists.", {}, "name-taken");
    entries[from] = { raw: s, style: s };
  } else if (at >= 0) entries[at] = { raw: s, style: s };
  else {
    if (shownOf(entries).length >= LIMITS.styles) throw new HttpError(409, `There is room for ${LIMITS.styles} styles; remove one first.`, {}, "limit");
    entries.push({ raw: s, style: s });
  }
  await writeStyles(space, entries);
  return shownOf(entries);
}

export async function deleteStyle(space: UserSpace, name: string): Promise<Style[]> {
  const entries = await entriesToChange(space);
  const left = entries.filter((x) => !(x.style && same(x.style.name, name)));
  if (left.length === entries.length) throw new HttpError(404, "There is no such style.");
  await writeStyles(space, left);
  return shownOf(left);
}
