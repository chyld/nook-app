// Finding 16: font names and slugs in CSS text are escaped.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cssString, familyStyle, previewFaces } from "../src/lib/fontcss.ts";

/** The text left when CSS strings (with their escapes) are taken out. */
const outsideStrings = (css: string) => css.replace(/"(?:\\[0-9a-f]{1,6} ?|\\.|[^"\\\n])*"/g, "S");

const HOSTILE = ["a'b", 'a"b', "a\\", "x\"; } body { display: none } /*", "line\nbreak", "semi;colon}"];

test("16: a font name cannot leave its CSS string", () => {
  for (const name of HOSTILE) {
    assert.equal(outsideStrings(cssString(name)), "S", JSON.stringify(name));
    assert.equal(outsideStrings(familyStyle(name)), "font-family: S, var(--font-ui)", JSON.stringify(name));
  }
  const faces = previewFaces(HOSTILE.map((slug) => ({ slug })), (s) => `/api/fonts/preview/${s}`);
  for (const line of faces.split("\n")) assert.equal(outsideStrings(line), '@font-face { font-family: S; src: url(S) format(S); font-display: swap; }', line);
});
