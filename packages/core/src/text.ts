// Small text facts shared by the server and the browser: byte order mark, line endings,
// UTF-8 sizes and cutting on a character boundary.

export const BOM = "\ufeff";

export function hasBom(text: string): boolean {
  return text.charCodeAt(0) === 0xfeff;
}

export type LineEndings = "none" | "lf" | "crlf" | "mixed";

/**
 * DESIGN 5.2: which line endings a text uses. "mixed" when it uses more than one kind or has a
 * lone CR (a CR not followed by LF), which the editor cannot keep.
 */
export function lineEndings(text: string): LineEndings {
  let lf = 0;
  let crlf = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x0d) {
      if (text.charCodeAt(i + 1) === 0x0a) {
        crlf++;
        i++;
      } else {
        return "mixed";
      }
    } else if (c === 0x0a) {
      lf++;
    }
  }
  if (lf && crlf) return "mixed";
  if (crlf) return "crlf";
  if (lf) return "lf";
  return "none";
}

/** Converts every line ending (CRLF, lone CR) to LF. */
export function toLf(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** The line ending that ends the first line, or LF when the text has a single line. */
export function firstLineEnding(text: string, from = 0): string {
  for (let i = from; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x0a) return "\n";
    if (c === 0x0d) return text.charCodeAt(i + 1) === 0x0a ? "\r\n" : "\r";
  }
  return "\n";
}

const encoder = new TextEncoder();

export function utf8Length(s: string): number {
  return encoder.encode(s).length;
}

/** The longest prefix of `s` that is at most `max` bytes in UTF-8, cut between characters. */
export function cutToBytes(s: string, max: number): string {
  let bytes = 0;
  let out = "";
  for (const ch of s) {
    const n = utf8Length(ch);
    if (bytes + n > max) break;
    bytes += n;
    out += ch;
  }
  return out;
}

/** Decodes UTF-8 bytes; null when they are not valid UTF-8. A byte order mark is kept. */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function encodeUtf8(s: string): Uint8Array {
  return encoder.encode(s);
}
