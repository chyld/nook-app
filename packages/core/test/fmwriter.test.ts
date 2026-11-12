// EDITOR-PLAN 7: Note settings write one front matter key and nothing else.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readSettings, writeSetting } from "../src/fmwriter.ts";

const ok = (r: ReturnType<typeof writeSetting>) => {
  assert.ok(r.ok, r.ok ? "" : r.reason);
  return r.text;
};

test("replaces the value on the key's last top-level line, keeping comments, order and other keys", () => {
  const src = "---\nid: abcdefghijk2\ntitle: Old # my title\n# a comment\ncustom: [1, 2]\ntitle: Older\n---\nBody\n";
  assert.equal(ok(writeSetting(src, "title", "New")), "---\nid: abcdefghijk2\ntitle: Old # my title\n# a comment\ncustom: [1, 2]\ntitle: New\n---\nBody\n");
  // grok 7: a title with a colon is quoted.
  assert.equal(ok(writeSetting("---\nid: abcdefghijk2\ntitle: \"Trip: Lisbon\"\n---\n", "title", "Trip: Porto")), "---\nid: abcdefghijk2\ntitle: \"Trip: Porto\"\n---\n");
  assert.equal(ok(writeSetting("---\ntitle: x # keep\n---\n", "title", "y")), "---\ntitle: y # keep\n---\n");
});

test("adds a line before the closing ---, or a front matter block; CRLF kept", () => {
  assert.equal(ok(writeSetting("---\nid: abcdefghijk2\n---\nBody", "font", "Caveat")), "---\nid: abcdefghijk2\nfont: Caveat\n---\nBody");
  assert.equal(ok(writeSetting("Body\r\nmore", "size", "14pt")), "---\r\nsize: 14pt\r\n---\r\nBody\r\nmore");
  assert.equal(ok(writeSetting("\ufeffBody", "size", "large")), "\ufeff---\nsize: large\n---\nBody");
  assert.equal(ok(writeSetting("---\r\nid: abcdefghijk2\r\n---\r\n", "tags", ["a", "b c"])), "---\r\nid: abcdefghijk2\r\ntags: [a, b c]\r\n---\r\n");
});

test("removes a key (all its top-level lines); an empty value removes it", () => {
  assert.equal(ok(writeSetting("---\nfont: A\ntitle: t\nfont: B\n---\nx", "font", null)), "---\ntitle: t\n---\nx");
  // With no key left the block goes: `---` and `---` alone would show as two lines.
  assert.equal(ok(writeSetting("---\ntags: [a]\n---\nx", "tags", [])), "x");
  assert.equal(ok(writeSetting("no front matter", "font", null)), "no front matter");
});

test("refuses what it cannot write safely, with a reason", () => {
  const block = "---\ntags:\n  - a\n  - b\n---\nx";
  assert.deepEqual(writeSetting(block, "tags", ["c"]), { ok: false, reason: "the tags is written over several lines; edit it in Raw" });
  assert.equal(writeSetting("---\n: : bad\n  - [\n---\nx", "title", "t").ok, false);
  assert.deepEqual(writeSetting("---\nid: abcdefghijk2\n---\nx", "size", "13.25pt"), { ok: false, reason: "this size is not a valid value" });
  // Values that YAML would read as something else are quoted.
  assert.equal(ok(writeSetting("---\n---\nx", "title", "yes")), "---\ntitle: \"yes\"\n---\nx");
  assert.equal(ok(writeSetting("---\n---\nx", "title", "12")), "---\ntitle: \"12\"\n---\nx");
  assert.equal(ok(writeSetting("---\n---\nx", "tags", ["a,b", "#x"])), "---\ntags: [\"a,b\", \"#x\"]\n---\nx");
});

test("the row's view: values, read-only fields, broken front matter", () => {
  const v = readSettings("---\ntitle: T\ntags:\n  - a\nsize: large\nfont: 12\n---\nx");
  assert.deepEqual(v.fields.title, { value: "T", writable: true });
  assert.equal(v.fields.tags.writable, false);
  assert.equal(v.fields.size.value, "large");
  assert.equal(readSettings("---\n: [\n---\nx").broken, true);
});
