// SPEC2 6, photos: types decided from the bytes; rotation applied, metadata removed, scaled;
// animation kept; pixel limits; names; served only if the bytes are an image; 429 when busy.

import { test } from "node:test";
import assert from "node:assert/strict";
import sharp, { type Sharp } from "sharp";
import { multipart, twoUsers } from "./http.ts";
import { photoBaseName, processPhoto, processingNow, sniff } from "../src/photos.ts";

const upload = async (c: Awaited<ReturnType<typeof twoUsers>>["alice"], id: string, name: string, data: Buffer) => {
  const m = multipart(name, data);
  return c.req("POST", `/api/notes/${id}/photos`, m.body, m.headers);
};

test("upload, store under a free name, serve; types from the bytes", async () => {
  const { alice, bob } = await twoUsers();
  const n = await alice.create("P");
  const big = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: "#ff0000" } }).jpeg().withExif({ IFD0: { Copyright: "secret-owner" } }).toBuffer();
  let r = await upload(alice, n.id, "My Holiday (1).JPG", big);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().file, "MyHoliday1.jpg");
  r = await upload(alice, n.id, "My Holiday (1).JPG", big);
  assert.equal(r.json().file, "MyHoliday1-2.jpg", "a number until it is free");
  r = await upload(alice, n.id, "日本.png", await sharp({ create: { width: 10, height: 10, channels: 4, background: "#00ff00" } }).png().toBuffer());
  assert.equal(r.json().file, "photo.png");
  const got = await alice.get(`/api/notes/${n.id}/assets/MyHoliday1.jpg`);
  assert.equal(got.statusCode, 200);
  assert.equal(got.headers["content-type"], "image/jpeg");
  assert.equal(got.headers["cache-control"], "private");
  assert.equal(got.headers["x-content-type-options"], "nosniff");
  const meta = await sharp(got.rawPayload).metadata();
  assert.equal(meta.width, 2560, "scaled to 2560 on the longer side");
  assert.equal(meta.exif, undefined, "metadata removed");
  assert.equal((await bob.get(`/api/notes/${n.id}/assets/MyHoliday1.jpg`)).statusCode, 404);
  // Not an image: refused; SVG is never taken.
  assert.equal((await upload(alice, n.id, "x.png", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).statusCode, 422);
  assert.equal((await upload(alice, n.id, "x.jpg", Buffer.from("not an image at all"))).statusCode, 422);
  assert.equal((await upload(alice, "aaaaaaaaaaaaaaaaaaaaaaaa", "x.png", big)).statusCode, 404);
  // Too large a body.
  const huge = multipart("x.jpg", Buffer.alloc(26 * 1024 * 1024, 1));
  assert.equal((await alice.req("POST", `/api/notes/${n.id}/photos`, huge.body, huge.headers)).statusCode, 413);
});

test("animation is kept, scaled to 1280; pixel limits", async () => {
  // Three frames of 1600 x 300, each its own colour (review, 40: the test made one frame).
  const frame = (bg: string) => sharp({ create: { width: 1600, height: 300, channels: 4, background: bg } }).png().toBuffer();
  const frames = await Promise.all(["#ff0000", "#00ff00", "#0000ff"].map(frame));
  const { alice } = await twoUsers();
  const n = await alice.create("A");
  for (const [name, encode] of [["a.gif", (x: Sharp) => x.gif({ loop: 0 })], ["a.webp", (x: Sharp) => x.webp({ loop: 0 })]] as const) {
    const animated = await encode(sharp(frames, { join: { animated: true } })).toBuffer();
    const inMeta = await sharp(animated, { animated: true }).metadata();
    assert.equal(inMeta.pages, 3, "the upload has three frames");
    const r = await upload(alice, n.id, name, animated);
    assert.equal(r.statusCode, 200, r.body);
    const out = await alice.get(`/api/notes/${n.id}/assets/${r.json().file}`);
    assert.equal(out.headers["content-type"], name.endsWith(".gif") ? "image/gif" : "image/webp");
    const meta = await sharp(out.rawPayload, { animated: true }).metadata();
    assert.equal(meta.pages, 3, `${name}: the animation is kept`);
    assert.equal(meta.width, 1280, `${name}: scaled to 1280 on the longer side`);
    assert.equal(meta.pageHeight, 240, `${name}: each frame scaled alike`);
    // The frames keep their own colours.
    const colours = await Promise.all([0, 1, 2].map(async (p) => (await sharp(out.rawPayload, { page: p }).raw().toBuffer()).subarray(0, 3).join(",")));
    assert.equal(new Set(colours).size, 3, `${name}: frames ${colours.join(" / ")}`);
  }
  // An image over 120 million pixels is refused (sharp's limit on the input).
  const vast = await sharp({ create: { width: 11000, height: 11000, channels: 3, background: "#000" } }).png({ compressionLevel: 9 }).toBuffer();
  const v = await upload(alice, n.id, "vast.png", vast);
  assert.ok(v.statusCode === 413 || v.statusCode === 422, `${v.statusCode}`);
});

test("names, sniffing, and two at once with four waiting", async () => {
  assert.equal(photoBaseName("../../etc/x y.png"), "xy");
  assert.equal(photoBaseName(".jpg"), "photo");
  assert.equal(photoBaseName("a_b-c.d.webp"), "a_b-cd");
  assert.equal(sniff(Buffer.from("GIF89a......")), "gif");
  assert.equal(sniff(Buffer.from("<svg")), null);
  const img = await sharp({ create: { width: 2000, height: 2000, channels: 3, background: "#abcdef" } }).png().toBuffer();
  const jobs = Array.from({ length: 6 }, () => processPhoto(img, "png"));
  assert.deepEqual(processingNow(), { running: 2, waiting: 4 });
  await assert.rejects(processPhoto(img, "png"), (e: { status?: number }) => e.status === 429);
  await Promise.all(jobs);
  assert.deepEqual(processingNow(), { running: 0, waiting: 0 });
});
