// SPEC 6 Photos.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseNote } from "../src/index.ts";
import { fileSystemImageCheck } from "../src/cli.ts";
import { decodeLocalPath, defaultIsLocalImageAllowed, isRemote } from "../src/images.ts";
import { html, p } from "./helpers.ts";

const placeholder = (src: string, alt: string) => `<span class="note-image-placeholder" data-src="${src}">${alt}</span>`;

test("6 a photo is referred to with a standard Markdown image", () => {
  assert.equal(html("![Tram 28 at dusk](<Lisbon trip.assets/tram.jpg>)"), p('<img src="Lisbon%20trip.assets/tram.jpg" alt="Tram 28 at dusk">'));
});

test("6 a path with spaces is written in angle brackets or with %20", () => {
  const want = p('<img src="Lisbon%20trip.assets/tram.jpg" alt="T">');
  assert.equal(html("![T](<Lisbon trip.assets/tram.jpg>)"), want);
  assert.equal(html("![T](Lisbon%20trip.assets/tram.jpg)"), want);
  // Without angle brackets a space ends the destination, so this is not an image.
  assert.equal(html("![T](Lisbon trip.assets/tram.jpg)"), p("![T](Lisbon trip.assets/tram.jpg)"));
});

test("6 classification: http:// or https:// in any letter case is remote, before any decoding", () => {
  assert.ok(isRemote("http://a.example/x.png"));
  assert.ok(isRemote("HTTPS://a.example/x.png"));
  assert.ok(!isRemote("https%3A//a.example/x.png"));
  assert.ok(!isRemote("ftp://a.example/x.png"));
  assert.ok(!isRemote("//a.example/x.png"));
});

test("6 classification: anything else is a local path, including Re: Lisbon.assets/tram.jpg", () => {
  // The colon is encoded, so the browser cannot read "Re:" as a URL scheme.
  assert.equal(html("![T](<Re: Lisbon.assets/tram.jpg>)"), p('<img src="Re%3A%20Lisbon.assets/tram.jpg" alt="T">'));
  assert.equal(html("![T](javascript:x.png)"), p('<img src="javascript%3Ax.png" alt="T">'));
});

test("6 a remote image is never loaded automatically, only after the person allows it", () => {
  assert.equal(html("![Map](https://maps.example/lisbon.png)"), p(placeholder("https://maps.example/lisbon.png", "Map")));
  assert.equal(html("![Map](https://maps.example/lisbon.png)", { allowRemoteImages: true }), p('<img src="https://maps.example/lisbon.png" alt="Map">'));
});

test("6 allowing a remote image does not change the file", () => {
  const src = "![Map](https://maps.example/lisbon.png)";
  const copy = src.slice();
  html(src, { allowRemoteImages: true });
  assert.equal(src, copy);
  assert.equal(parseNote(src).range.end, src.length);
});

test("6 in a local path, % and two hex digits is decoded; any other % is literal", () => {
  assert.equal(decodeLocalPath("a%20b%2Fc"), "a b/c");
  assert.equal(decodeLocalPath("100%.jpg"), "100%.jpg");
  assert.equal(decodeLocalPath("a%zz%4"), "a%zz%4");
  assert.equal(decodeLocalPath("caf%C3%A9.jpg"), "café.jpg");
  assert.equal(html("![T](100%.jpg)"), p('<img src="100%25.jpg" alt="T">'));
  assert.equal(html("![T](caf%C3%A9.jpg)"), p('<img src="caf%C3%A9.jpg" alt="T">'));
});

test("6 a decoded path that is not valid UTF-8 is not loaded", () => {
  assert.equal(decodeLocalPath("%FF.jpg"), null);
  assert.equal(html("![T](%FF.jpg)"), p(placeholder("%FF.jpg", "T")));
});

test("6 the decoded path is what the local image check receives", () => {
  const seen: string[] = [];
  html("![T](Lisbon%20trip.assets/tram.jpg)", { isLocalImageAllowed: (d) => (seen.push(d), true) });
  assert.deepEqual(seen, ["Lisbon trip.assets/tram.jpg"]);
});

test("6 absolute paths and paths that leave the folder are not loaded (default check)", () => {
  assert.equal(html("![T](/etc/x.jpg)"), p(placeholder("/etc/x.jpg", "T")));
  assert.equal(html("![T](../x.jpg)"), p(placeholder("../x.jpg", "T")));
  assert.equal(html("![T](a/../../x.jpg)"), p(placeholder("a/../../x.jpg", "T")));
  assert.equal(html("![T](%2Fetc/x.jpg)"), p(placeholder("%2Fetc/x.jpg", "T")));
  assert.equal(html("![T](a/..%2F..%2Fx.jpg)"), p(placeholder("a/..%2F..%2Fx.jpg", "T")));
  assert.equal(html("![T](a/../x.jpg)"), p('<img src="a/../x.jpg" alt="T">'));
  assert.ok(defaultIsLocalImageAllowed("a/b.jpg"));
  assert.ok(!defaultIsLocalImageAllowed(""));
});

test("6 an image that is not allowed by the app's check is a placeholder", () => {
  assert.equal(html("![T](a.jpg)", { isLocalImageAllowed: () => false }), p(placeholder("a.jpg", "T")));
});

test("6 a relative path is resolved against the note's folder; symbolic links are followed (CLI check)", () => {
  const root = mkdtempSync(join(tmpdir(), "noteformat-"));
  try {
    mkdirSync(join(root, "notes", "Trip.assets"), { recursive: true });
    writeFileSync(join(root, "notes", "Trip.assets", "tram.jpg"), "x");
    writeFileSync(join(root, "outside.jpg"), "x");
    symlinkSync(join(root, "outside.jpg"), join(root, "notes", "Trip.assets", "link.jpg"));
    symlinkSync(join(root, "notes", "Trip.assets", "tram.jpg"), join(root, "notes", "inside-link.jpg"));
    const check = fileSystemImageCheck(join(root, "notes", "Trip.md"), join(root, "notes"));
    assert.equal(check("Trip.assets/tram.jpg"), true);
    assert.equal(check("inside-link.jpg"), true);
    assert.equal(check("Trip.assets/link.jpg"), false, "a link that points outside the notes folder");
    assert.equal(check("../outside.jpg"), false);
    assert.equal(check(join(root, "notes", "Trip.assets", "tram.jpg")), false, "an absolute path");
    assert.equal(check("Trip.assets/missing.jpg"), false, "a missing file");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("6 a missing or not loaded image is a placeholder with its alt text and its path or URL", () => {
  assert.equal(html("![Tram & tiles](<a b.jpg>)", { isLocalImageAllowed: () => false }), p(placeholder("a b.jpg", "Tram &amp; tiles")));
  assert.equal(html('![x](https://e.example/"q".png)'), p(placeholder("https://e.example/&quot;q&quot;.png", "x")));
});

test("6 the alt text is the plain text of the description", () => {
  assert.equal(html("![a *b* [c]{color=red} `d`](x.png)"), p('<img src="x.png" alt="a b c d">'));
});

test("6 supported image types: JPEG, PNG, GIF, WebP and AVIF", () => {
  for (const ext of ["jpg", "jpeg", "JPG", "png", "gif", "webp", "avif"]) {
    assert.equal(html(`![T](a.${ext})`), p(`<img src="a.${ext}" alt="T">`));
  }
  for (const ext of ["bmp", "svg", "tiff", "heic"]) {
    assert.equal(html(`![T](a.${ext})`), p(placeholder(`a.${ext}`, "T")));
  }
});

test("6 an image title is kept", () => {
  assert.equal(html('![T](a.png "The title")'), p('<img src="a.png" alt="T" title="The title">'));
});

test("6 an upper-case remote scheme is remote: placeholder by default, loaded when allowed", () => {
  assert.equal(html("![T](HTTPS://e.example/m.png)"), p(placeholder("HTTPS://e.example/m.png", "T")));
  assert.equal(html("![T](HTTPS://e.example/m.png)", { allowRemoteImages: true }), p('<img src="HTTPS://e.example/m.png" alt="T">'));
  assert.equal(html("![T](Http://e.example/m.png)"), p(placeholder("Http://e.example/m.png", "T")));
});

test("6 absolute paths of other systems are not loaded: drive paths, UNC paths, backslash ..", () => {
  for (const path of ["C:/notes/a.png", "C:\\notes\\a.png", "c:a.png", "\\\\server\\share\\a.png", "\\a.png", "..\\a.png", "a\\..\\..\\b.png"]) {
    assert.equal(defaultIsLocalImageAllowed(path), false, path);
  }
  assert.equal(html("![T](<C:/notes/a.png>)"), p(placeholder("C:/notes/a.png", "T")));
  assert.equal(html("![T](C:%5Cnotes%5Ca.png)"), p(placeholder("C:%5Cnotes%5Ca.png", "T")));
  assert.equal(html("![T](%5C%5Cserver%5Cshare%5Ca.png)"), p(placeholder("%5C%5Cserver%5Cshare%5Ca.png", "T")));
  assert.equal(html("![T](a%5C..%5C..%5Cb.png)"), p(placeholder("a%5C..%5C..%5Cb.png", "T")));
  // A colon later in the first segment is not a drive: SPEC 6's own example stays a local path.
  assert.ok(defaultIsLocalImageAllowed("Re: Lisbon.assets/tram.jpg"));
  assert.ok(defaultIsLocalImageAllowed("a\\..\\b.png"));
});
