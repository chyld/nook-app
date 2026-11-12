// SPEC 6: how an image destination is classified, decoded and checked.

/** Image types the format supports (SPEC 6), by file extension. */
export const SUPPORTED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"];

/**
 * SPEC 6: a destination is classified as written, before any decoding. If it starts with
 * `http://` or `https://`, in any letter case, it is remote; anything else is a local path.
 */
export function isRemote(destination: string): boolean {
  return /^https?:\/\//i.test(destination);
}

/**
 * SPEC 6: in a local path, `%` followed by two hexadecimal digits is decoded; any other `%` is
 * literal. The decoded bytes are read as UTF-8; returns null if they are not valid UTF-8.
 */
export function decodeLocalPath(path: string): string | null {
  const bytes: number[] = [];
  const enc = new TextEncoder();
  for (let i = 0; i < path.length; ) {
    if (path[i] === "%" && /^[0-9a-fA-F]{2}$/.test(path.slice(i + 1, i + 3))) {
      bytes.push(parseInt(path.slice(i + 1, i + 3), 16));
      i += 3;
      continue;
    }
    const cp = path.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    for (const b of enc.encode(ch)) bytes.push(b);
    i += ch.length;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}

/**
 * The default local image check of the brief: true for a relative path that does not start
 * with "/" and does not leave its folder through "..". It also refuses absolute paths of other
 * systems: a drive path (`C:/…`, `C:\…`, or `C:…`, which is relative to a drive), a path that
 * starts with a backslash (`\\server\share\…`, `\…`), and `..` written with backslashes.
 * The app supplies the real filesystem check (symbolic links, the notes folder the person opened).
 */
export function defaultIsLocalImageAllowed(decodedPath: string): boolean {
  if (decodedPath === "" || decodedPath.startsWith("/") || decodedPath.startsWith("\\")) return false;
  if (/^[A-Za-z]:/.test(decodedPath)) return false;
  let depth = 0;
  for (const segment of decodedPath.split(/[\\/]/)) {
    if (segment === "..") {
      depth--;
      if (depth < 0) return false;
    } else if (segment !== "." && segment !== "") {
      depth++;
    }
  }
  return true;
}

export function hasSupportedExtension(decodedPath: string): boolean {
  const lower = decodedPath.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Encodes a decoded local path for use in a URL: each segment is percent-encoded, so that a
 * space becomes %20 and a colon cannot be read as a URL scheme. Returns null if the path holds
 * a lone surrogate.
 */
export function encodeLocalPath(decodedPath: string): string | null {
  try {
    return decodedPath.split("/").map(encodeURIComponent).join("/");
  } catch {
    return null;
  }
}
