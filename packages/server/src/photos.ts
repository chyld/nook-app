// SPEC2 6, photos: the type is decided from the bytes on upload and again when served; `sharp`
// applies the rotation, removes all metadata, scales, and keeps animation. The slow work is done
// before the user's lock is taken (4.1, rule 2).

import sharp, { type Metadata } from "sharp";
import { LIMITS } from "../../contract/src/index.ts";
import { HttpError } from "./errors.ts";

// No image cache between uploads: memory goes back as soon as a photo is done.
sharp.cache(false);

export const PROCESS_AT_ONCE = 2;
export const PROCESS_WAITING = 4;

export type PhotoType = "jpeg" | "png" | "webp" | "gif" | "avif";

export const EXTENSION: Record<PhotoType, string> = { jpeg: ".jpg", png: ".png", webp: ".webp", gif: ".gif", avif: ".avif" };
export const CONTENT_TYPE: Record<PhotoType, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif" };

/** The type of an image from its first bytes; null for anything else (SVG included). */
export function sniff(b: Uint8Array): PhotoType | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return "gif";
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (b.length >= 12 && ascii(4, 8) === "ftyp") {
    const size = Math.min(((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0, b.length, 256);
    for (let p = 8; p + 4 <= size; p += 4) {
      if (p === 12) continue; // minor version
      const brand = ascii(p, p + 4);
      if (brand === "avif" || brand === "avis") return "avif";
    }
  }
  return null;
}

let running = 0;
const waiting: (() => void)[] = [];

/**
 * Two images are processed at once and four may wait; beyond that 429 (section 6). An upload
 * takes its place here before its body is read, so a waiting upload's bytes stay in the
 * connection and at most two bodies are in memory at once.
 */
export async function photoSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= PROCESS_AT_ONCE) {
    if (waiting.length >= PROCESS_WAITING) throw new HttpError(429, "The server is busy with photos. Try again in a moment.");
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else running++;
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}

/** Processes one image in a slot of its own (`photoSlot`). */
export function processPhoto(input: Buffer, type: PhotoType): Promise<Buffer> {
  return photoSlot(() => processImage(input, type));
}

export function processingNow(): { running: number; waiting: number } {
  return { running, waiting: waiting.length };
}

/** Processes one image; the caller holds a slot. */
export async function processImage(input: Buffer, type: PhotoType): Promise<Buffer> {
  const animatedType = type === "gif" || type === "webp";
  const opts = { animated: animatedType, limitInputPixels: LIMITS.stillPixels, failOn: "error" as const };
  let meta: Metadata;
  try {
    meta = await sharp(input, opts).metadata();
  } catch {
    throw new HttpError(422, "This image cannot be read, or it is too large.", {}, "not-an-image");
  }
  const pages = meta.pages ?? 1;
  const width = meta.width ?? 0;
  const pageHeight = meta.pageHeight ?? meta.height ?? 0;
  if (!width || !pageHeight || width * pageHeight * pages > LIMITS.stillPixels) throw new HttpError(413, "This image has too many pixels (at most 120 million).");
  if (pages > 1 && width * pageHeight * pages > LIMITS.animatedPixels) throw new HttpError(413, "This animation has too many pixels (at most 25 million in all its frames together).");
  let img = sharp(input, opts);
  if (pages === 1) img = img.rotate();
  const side = pages > 1 ? LIMITS.animatedSide : LIMITS.stillSide;
  img = img.resize({ width: side, height: side, fit: "inside", withoutEnlargement: true });
  // sharp writes no metadata unless asked to.
  switch (type) {
    case "jpeg":
      img = img.jpeg({ quality: 88, mozjpeg: true });
      break;
    case "png":
      img = img.png();
      break;
    case "webp":
      img = img.webp({ quality: 88 });
      break;
    case "gif":
      img = img.gif();
      break;
    case "avif":
      img = img.avif({ quality: 60 });
      break;
  }
  try {
    return await img.toBuffer();
  } catch {
    throw new HttpError(422, "This image cannot be processed.", {}, "not-an-image");
  }
}

/** The stored name's base: the original name reduced to `A-Z a-z 0-9 _ -`, `photo` if nothing
 *  is left (section 6). */
export function photoBaseName(original: string): string {
  const base = original.slice(Math.max(original.lastIndexOf("/"), original.lastIndexOf("\\")) + 1);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : dot === 0 ? "" : base;
  let s = stem.replace(/[^A-Za-z0-9_-]+/g, "").slice(0, 100);
  if (s === "") s = "photo";
  return s;
}
