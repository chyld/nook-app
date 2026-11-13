// SPEC2 4.2: the files on disk. Every path the server uses is made here, and every note path
// by one function, `notePath` (section 5, "keeping people apart"): each name is checked against
// the patterns of `contract` and is one path part, and the result must lie inside the user's
// folder. Symbolic links are refused by `safefs`.

import path from "node:path";
import { RE, type Kind } from "../../contract/src/index.ts";
import { registerRoot } from "./safefs.ts";

export class PathError extends Error {
  override name = "PathError";
}

/** `dir/part`, refusing anything that is not a single path part inside `dir`. */
export function inside(dir: string, part: string): string {
  if (part === "" || part === "." || part === ".." || part.includes("/") || part.includes("\\") || part.includes("\0")) throw new PathError("not a single path part");
  const p = path.join(dir, part);
  if (path.dirname(p) !== dir) throw new PathError("path leaves its folder");
  return p;
}

export type NotePart =
  | "dir"
  | "note.md"
  | "drawing.excalidraw"
  | "note.assets"
  | "history"
  | "trashed.json"
  | { asset: string }
  | { version: string; kind: Kind };

/** Each kind's main file, which decides the kind of a folder (SPEC-DRAWINGS 4.1). */
export const MAIN_FILE = { note: "note.md", drawing: "drawing.excalidraw" } as const satisfies Record<Kind, NotePart>;
/** Each kind's file extension, of the main file and of its history versions. */
export const EXT: Record<Kind, string> = { note: ".md", drawing: ".excalidraw" };

export class DataLayout {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
    registerRoot(this.root);
  }

  get config(): string {
    return path.join(this.root, "config");
  }
  get usersFile(): string {
    return path.join(this.config, "users.json");
  }
  get sessions(): string {
    return path.join(this.config, "sessions");
  }
  get backupFile(): string {
    return path.join(this.config, "backup.json");
  }
  get configTmp(): string {
    return path.join(this.config, "tmp");
  }
  get cache(): string {
    return path.join(this.root, "cache");
  }
  get cacheTmp(): string {
    return path.join(this.cache, "tmp");
  }
  get catalogue(): string {
    return path.join(this.cache, "google-fonts.json");
  }
  get previews(): string {
    return path.join(this.cache, "font-previews");
  }
  get removed(): string {
    return path.join(this.root, "removed");
  }
  get users(): string {
    return path.join(this.root, "users");
  }

  user(userId: string): UserLayout {
    if (!RE.userId.test(userId)) throw new PathError("not a user id");
    return new UserLayout(inside(this.users, userId));
  }
}

export class UserLayout {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  get notes(): string {
    return path.join(this.root, "notes");
  }
  get trash(): string {
    return path.join(this.root, "trash");
  }
  get fonts(): string {
    return path.join(this.root, "fonts");
  }
  get tmp(): string {
    return path.join(this.root, "tmp");
  }
  get styles(): string {
    return path.join(this.root, "styles.json");
  }

  /** A path of a live note (`where` "notes") or a trashed one ("trash"). */
  notePath(noteId: string, part: NotePart, where: "notes" | "trash" = "notes"): string {
    if (!RE.noteId.test(noteId)) throw new PathError("not a note id");
    const dir = inside(where === "notes" ? this.notes : this.trash, noteId);
    let p: string;
    if (part === "dir") p = dir;
    else if (part === "note.md" || part === "drawing.excalidraw" || part === "note.assets" || part === "history" || part === "trashed.json") p = inside(dir, part);
    else if ("asset" in part) {
      if (!RE.photoFile.test(part.asset)) throw new PathError("not a photo name");
      p = inside(inside(dir, "note.assets"), part.asset);
    } else {
      if (!RE.version.test(part.version)) throw new PathError("not a version");
      p = inside(inside(dir, "history"), `${part.version}${EXT[part.kind]}`);
    }
    const rel = path.relative(this.root, p);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new PathError("path leaves the user's folder");
    return p;
  }

  fontDir(slug: string): string {
    if (!RE.fontSlug.test(slug)) throw new PathError("not a font slug");
    return inside(this.fonts, slug);
  }
}
