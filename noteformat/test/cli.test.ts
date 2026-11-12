// src/cli.ts: the fragment and the --page output.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { themeName } from "../src/cli.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const run = (...args: string[]) => execFileSync(process.execPath, [cli, ...args], { encoding: "utf8" });

function withNote(source: string, fn: (file: string, dir: string) => void, name = "Note.md") {
  const dir = mkdtempSync(join(tmpdir(), "noteformat-cli-"));
  try {
    const file = join(dir, name);
    writeFileSync(file, source);
    fn(file, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("cli: node src/cli.ts FILE.md prints the HTML fragment", () => {
  withNote("# Hi\n\n[x]{color=red}", (file) => {
    assert.equal(run(file), '<h1>Hi</h1>\n<p><span style="color: var(--note-red)">x</span></p>\n');
  });
});

test("cli: --page prints a complete page that links the theme stylesheet", () => {
  withNote("---\ntitle: My <note>\nfont: serif\n---\ntext", (file) => {
    const page = run(file, "--page", "--css", "paper.css");
    assert.match(page, /^<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">/);
    assert.match(page, /<title>My &lt;note&gt;<\/title>/);
    assert.match(page, /<link rel="stylesheet" href="paper.css">/);
    assert.match(page, /<article class="note" style="font-family: var\(--note-font-serif\)">\n<p>text<\/p>\n<\/article>/);
  });
});

test("cli: local images get the real filesystem check; existing files load, missing ones are placeholders", () => {
  withNote("![a](<Note.assets/a.png>)\n\n![b](<Note.assets/missing.png>)", (file, dir) => {
    mkdirSync(join(dir, "Note.assets"));
    writeFileSync(join(dir, "Note.assets", "a.png"), "png");
    assert.equal(
      run(file),
      '<p><img src="Note.assets/a.png" alt="a"></p>\n<p><span class="note-image-placeholder" data-src="Note.assets/missing.png">b</span></p>\n',
    );
  });
});

test("cli: remote images only with --allow-remote-images", () => {
  withNote("![m](https://e.example/m.png)", (file) => {
    assert.match(run(file), /note-image-placeholder/);
    assert.equal(run(file, "--allow-remote-images"), '<p><img src="https://e.example/m.png" alt="m"></p>\n');
  });
});

test("cli: a file that is not valid UTF-8 is not a note and is reported", () => {
  const dir = mkdtempSync(join(tmpdir(), "noteformat-cli-"));
  try {
    const file = join(dir, "bad.md");
    writeFileSync(file, Buffer.from([0x61, 0xff, 0x62]));
    assert.throws(() => execFileSync(process.execPath, [cli, file], { encoding: "utf8", stdio: "pipe" }), /not valid UTF-8/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli: a byte order mark is ignored", () => {
  withNote("\uFEFF# Hi", (file) => assert.equal(run(file), "<h1>Hi</h1>\n"));
});

test("3 theme: an unknown theme name means the app's default theme", () => {
  assert.equal(themeName("paper"), "paper");
  assert.equal(themeName("no-such-theme"), "paper");
  assert.equal(themeName(undefined), "paper");
});
