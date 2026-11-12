// Findings of section 3 of the version 2 code review in `core` (17 to 22): scenarios through
// `reduce`, as in scenarios.test.ts. Each test names its finding.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel, type Intent, type Mode } from "../src/index.ts";
import { parse, run, show } from "./scenario.ts";

function out(marked: string, intent: Intent, mode: Mode = "rich"): string {
  const r = run(marked, intent, mode);
  assert.ok("out" in r, `${JSON.stringify(marked)} + ${JSON.stringify(intent)}: refused: ${"refused" in r ? r.refused : ""}`);
  return r.out;
}
function refused(marked: string, intent: Intent, mode: Mode = "rich"): string {
  const r = run(marked, intent, mode);
  assert.ok("refused" in r, `${JSON.stringify(marked)} + ${JSON.stringify(intent)}: expected a refusal, got ${"out" in r ? JSON.stringify(r.out) : ""}`);
  return r.refused;
}

// On a blank line of a code block, the Block menu leaves the block (`leaveCode`); elsewhere it
// converts the block (7.6).
test("17: leaving a code block from the Block menu finds its own closing fence", () => {
  // A block opened with four backticks holds a line of three: that line is code, not the end.
  for (const mode of ["rich", "raw"] as const) {
    const r = run("````\na\n¦\n```\nb\n````", { type: "setBlock", kind: "paragraph" }, mode);
    assert.ok("out" in r, mode);
    assert.equal(r.out, "````\na\n\n```\nb\n````\n\n¦", mode);
  }
  assert.equal(out("```\ncode\n¦\n```", { type: "setBlock", kind: "paragraph" }), "```\ncode\n```\n\n¦", "the ordinary case");
});

test("17: leaving a code block never changes the code's text", () => {
  const code = (t: string) => {
    const m = buildModel(t);
    return m.chars.filter((c) => m.blocks[c.block].info.kind === "code").map((c) => c.ch).join("");
  };
  for (const text of ["~~~~\nx\n~~~\n\n```\n\ny\n~~~~\n\nafter", "````\n\n```\n\n````", "```\na\n\n~~~\n\n```"]) {
    for (let p = 0; p <= text.length; p++) {
      const line = text.slice(text.lastIndexOf("\n", p - 1) + 1, (text.indexOf("\n", p) + 1 || text.length + 1) - 1);
      if (line !== "") continue;
      for (const mode of ["rich", "raw"] as const) {
        const r = run(text.slice(0, p) + "¦" + text.slice(p), { type: "setBlock", kind: "h2" }, mode);
        if (!("out" in r)) continue;
        if (buildModel(text).blocks.every((b) => b.info.kind !== "code" || p < b.info.range.start || p > b.info.range.end)) continue;
        assert.equal(code(r.doc.text).replace(/\n+$/, ""), code(text).replace(/\n+$/, ""), `${mode}, caret at ${p} of ${JSON.stringify(text)}: ${JSON.stringify(r.out)}`);
      }
    }
  }
});

test("18: Clear, then Bold, with nothing selected: what is typed is plain bold", () => {
  let doc = parse("*it*¦");
  for (const i of [{ type: "setMark", change: { kind: "clear" } }, { type: "setMark", change: { kind: "bold", on: true } }, { type: "insertText", text: "x" }] as Intent[]) {
    const r = run(doc, i);
    assert.ok("out" in r, JSON.stringify(i));
    doc = r.doc;
  }
  const x = buildModel(doc.text).chars.find((c) => c.ch === "x")!;
  assert.equal(x.style.bold, true, show(doc));
  assert.equal(x.style.italic, false, `the waiting clear was dropped: ${show(doc)}`);
});

test("18: Bold, then Clear, with nothing selected: what is typed is plain", () => {
  let doc = parse("*it*¦");
  for (const i of [{ type: "setMark", change: { kind: "bold", on: true } }, { type: "setMark", change: { kind: "clear" } }, { type: "insertText", text: "x" }] as Intent[]) {
    const r = run(doc, i);
    assert.ok("out" in r);
    doc = r.doc;
  }
  const x = buildModel(doc.text).chars.find((c) => c.ch === "x")!;
  assert.equal(x.style.bold || x.style.italic, false, show(doc));
});

test("19: a size outside 1 to 400, or with two decimals, is refused with nothing selected too", () => {
  for (const pt of [0, 0.5, 400.1, 9999, 12.34, Number.NaN]) {
    assert.match(refused("Hi¦", { type: "setMark", change: { kind: "size", pt } }), /1 to 400/, String(pt));
    assert.match(refused("«Hi»", { type: "setMark", change: { kind: "size", pt } }), /1 to 400/, String(pt));
  }
  assert.ok("out" in run("Hi¦", { type: "setMark", change: { kind: "size", pt: 12.5 } }));
});

test("20: Raw mode, List or Block on a blank line inside the front matter does not write into it", () => {
  const fm = "---\ntitle: a\n¦\ntags: [x]\n---\n\nbody";
  for (const i of [{ type: "setList", kind: "bullet" }, { type: "setList", kind: "ordered" }, { type: "setBlock", kind: "h1" }, { type: "setBlock", kind: "code" }, { type: "setBlock", kind: "quote" }] as Intent[]) {
    assert.match(refused(fm, i, "raw"), /front matter/i, JSON.stringify(i));
  }
  // Typing there is plain text entry, and stays allowed.
  assert.ok("out" in run(fm, { type: "insertText", text: "font: sans" }, "raw"));
  // The same intents in the body still work.
  assert.equal(out("---\ntitle: a\n---\n\nbody\n\n¦", { type: "setList", kind: "bullet" }, "raw"), "---\ntitle: a\n---\n\nbody\n\n- ¦");
});

/** The caret keeps its distance from the end of the text (the text after it is unchanged). */
function keepsPlace(marked: string, intent: Intent): void {
  const before = parse(marked);
  const r = run(before, intent);
  assert.ok("out" in r);
  const fromEnd = (d: { text: string; sel: { anchor: number; head: number } }) => [d.text.length - d.sel.anchor, d.text.length - d.sel.head];
  assert.deepEqual(fromEnd(r.doc), fromEnd(before), `${JSON.stringify(marked)} + ${JSON.stringify(intent)}: ${JSON.stringify(r.out)}`);
}

test("21: adding a title to a note with no front matter keeps the caret in the text", () => {
  assert.match(out("¦Hello", { type: "setMeta", key: "title", value: "T" }), /^---\ntitle: T\n---\n\n?¦Hello$/);
  keepsPlace("¦Hello", { type: "setMeta", key: "title", value: "T" });
  keepsPlace("He¦llo", { type: "setMeta", key: "title", value: "T" });
  keepsPlace("«Hello»", { type: "setMeta", key: "tags", value: ["a"] });
  keepsPlace("¦- item", { type: "setMeta", key: "title", value: "T" });
  keepsPlace("¦---", { type: "setMeta", key: "font", value: "sans" });
  // Removing the last key removes the block; the caret stays with the text.
  keepsPlace("---\ntitle: T\n---\n\nHe¦llo", { type: "setMeta", key: "title", value: null });
  keepsPlace("---\ntitle: T\n---\n\n¦Hello", { type: "setMeta", key: "title", value: "A much longer title" });
});

test("22: + on text larger than 400 pt (a heading in a large note) does not make it smaller", () => {
  // A level-1 heading is twice the note's size: 600 pt in a note of 300 pt.
  const big = "---\nsize: 300pt\n---\n# «Big»";
  assert.equal(buildModel(big.replace(/[«»]/g, "")).chars[0].style.size, 600);
  const r = run(big, { type: "setMark", change: { kind: "size-step", dir: 1 } });
  if ("out" in r) assert.equal(buildModel(r.doc.text).chars[0].style.size >= 600, true, r.out);
  // − brings it toward the range; at 400 + changes nothing.
  assert.equal(out("«Big»\n{size=400pt}", { type: "setMark", change: { kind: "size-step", dir: 1 } }), "«Big»\n{size=400pt}");
  // With nothing selected, the waiting size does not go down either.
  const t = run("---\nsize: 300pt\n---\n# Big¦", { type: "setMark", change: { kind: "size-step", dir: 1 } });
  assert.ok("out" in t);
  const waiting = t.doc.typing.marks.find((c) => c.kind === "size");
  assert.ok(!waiting || (waiting.kind === "size" && waiting.pt >= 400), JSON.stringify(t.doc.typing));
});

// Found by the strengthened property test (finding 36): `setList` sets a value (7.3), so over a
// selection that also holds a heading or a table it changes nothing when its items already are
// of that kind; `toggleList` alone would turn them off.
test("found by 36: setList over items already of that kind and other blocks changes nothing", () => {
  for (const kind of ["ordered", "bullet", "task"] as const) {
    const marker = { ordered: ["1. ", "2. "], bullet: ["- ", "- "], task: ["- [ ] ", "- [x] "] }[kind];
    for (const text of [`«### Head\n\n${marker[0]}one\n${marker[1]}two»\n`, `«${marker[0]}one\n${marker[1]}two\n\n| a |\n| --- |\n| b |»\n`]) {
      assert.equal(out(text, { type: "setList", kind }), text, `${kind}: ${JSON.stringify(text)}`);
    }
  }
  // And "none" still removes them.
  assert.equal(out("«### Head\n\n1. one\n2. two»\n", { type: "setList", kind: "none" }).includes("1. "), false);
});

// Found by the generated test of finding 38: typing over a selection that ends inside markup
// (or starts inside it) lost a space next to it, as version 1 did.
test("found by 38: typing over a selection that ends or starts inside markup keeps the text beside it", () => {
  const vis = (t: string) => buildModel(t).chars.map((c) => c.ch).join("");
  for (const [marked, ins, want] of [
    ["«\\* ~~beta»~~ {name}", "#", "# {name}"],
    ["«a **bo»ld** c", "x", "xld c"],
    ["a **bo«ld** c»", "x", "a box"],
  ] as const) {
    const r = run(marked, { type: "insertText", text: ins });
    assert.ok("out" in r, marked);
    assert.equal(vis(r.doc.text), want, `${JSON.stringify(marked)} gave ${JSON.stringify(r.out)}`);
  }
});
