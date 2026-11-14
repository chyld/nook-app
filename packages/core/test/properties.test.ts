// SPEC2 12, `core` properties: random notes and random intents. The result always parses;
// `edit` lies inside the intent's region (7.4) and bytes outside it are unchanged; applying
// `edit` to the old text gives the new text; a setting intent applied twice gives the same text
// as once. And `core` bytes: `load` then `serialize` gives the same bytes.

import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { buildModel, load, reduce, serialize, tablesOf, type Change, type Doc, type Intent, type Mode, type SavedStyle } from "../src/index.ts";
import { rng } from "./gen.ts";
import { touchedBlocks } from "../src/style/blocks.ts";
import { genWidgetNote } from "./gen-widgets.ts";

const NOTE = fc.integer({ min: 1, max: 2 ** 31 - 1 }).map((seed) => genWidgetNote(rng(seed)));

const CHANGE: fc.Arbitrary<Change> = fc.oneof(
  fc.record({ kind: fc.constantFrom("bold" as const, "italic" as const, "strike" as const, "underline" as const, "code" as const), on: fc.boolean() }),
  fc.record({ kind: fc.constantFrom("color" as const, "bg" as const), value: fc.constantFrom("red", "blue", null) }),
  fc.record({ kind: fc.constant("font" as const), value: fc.constantFrom("sans", "mono", null) }),
  fc.record({ kind: fc.constant("size" as const), pt: fc.constantFrom(9, 12, 14, 18.5) }),
  fc.record({ kind: fc.constant("size-step" as const), dir: fc.constantFrom(1 as const, -1 as const) }),
  fc.constant({ kind: "clear" as const }),
);

const STYLE: SavedStyle = { name: "Loud", bold: true, italic: false, underline: true, strike: false, size: 14, font: null, color: "red", bg: null };
const PLAIN_RUN = { bold: false, italic: false, underline: false, strike: false, code: false, color: null, bg: null, font: null, size: null, link: null };

/** `at` of the widget and table intents is given as a fraction, and resolved on the note. */
const AT = -1;
const INTENT: fc.Arbitrary<Intent> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ type: fc.constant("insertText" as const), text: fc.constantFrom("a", "x y", " ", "*", "#", "`", "[", "_", "é", "日", "1.", "- ") }) },
  { weight: 3, arbitrary: fc.constantFrom<Intent>({ type: "deleteBackward" }, { type: "deleteForward" }, { type: "deleteWordBackward" }, { type: "deleteWordForward" }, { type: "cut" }) },
  { weight: 2, arbitrary: fc.constantFrom<Intent>({ type: "enter" }, { type: "lineBreak" }) },
  { weight: 1, arbitrary: fc.record({ type: fc.constant("paste" as const), plain: fc.constantFrom("one\ntwo", "*x*", "plain", "# head", "> quoted", "```\ncode\n```", "Title\n===") }) },
  { weight: 4, arbitrary: fc.record({ type: fc.constant("setMark" as const), change: CHANGE }) },
  { weight: 2, arbitrary: fc.record({ type: fc.constant("applyStyle" as const), style: fc.constantFrom<SavedStyle | "reset">(STYLE, "reset") }) },
  { weight: 1, arbitrary: fc.constant<Intent>({ type: "shortcut" }) },
  { weight: 2, arbitrary: fc.record({ type: fc.constant("setList" as const), kind: fc.constantFrom("none" as const, "bullet" as const, "ordered" as const, "task" as const) }) },
  { weight: 1, arbitrary: fc.record({ type: fc.constant("setLink" as const), href: fc.constantFrom("https://example.org", null) }) },
  { weight: 1, arbitrary: fc.record({ type: fc.constant("insertBlock" as const), what: fc.constantFrom("table" as const, "rule" as const) }) },
  { weight: 1, arbitrary: fc.constant<Intent>({ type: "insertPhoto", file: "p.png" }) },
  { weight: 2, arbitrary: fc.record({ type: fc.constant("setMeta" as const), key: fc.constantFrom("title" as const, "font" as const, "size" as const), value: fc.constantFrom("Hello", "sans", "14pt", "", null) }) },
  { weight: 1, arbitrary: fc.record({ type: fc.constant("setMeta" as const), key: fc.constant("tags" as const), value: fc.constantFrom<string[]>(["a", "b"], ["work"], []) }) },
  // Alpha's changes 8 and 12 (review of them, 28): the spacing key and the line under a final table.
  { weight: 1, arbitrary: fc.record({ type: fc.constant("setMeta" as const), key: fc.constant("spacing" as const), value: fc.constantFrom("0", "1", "2.5", "5", null) }) },
  { weight: 1, arbitrary: fc.constant<Intent>({ type: "lineAfterTable" }) },
  { weight: 2, arbitrary: fc.constant<Intent>({ type: "toggleTask", at: AT }) },
  { weight: 2, arbitrary: fc.record({ type: fc.constant("setImageWidth" as const), at: fc.constant(AT), value: fc.constantFrom(25, 50, 100) }) },
  {
    weight: 3,
    arbitrary: fc.record({
      type: fc.constant("tableEdit" as const),
      at: fc.constant(AT),
      op: fc.constantFrom<Extract<Intent, { type: "tableEdit" }>["op"]>(
        { op: "setCell", row: 1, col: 0, runs: [{ text: "new", style: PLAIN_RUN }] },
        { op: "setCellSource", row: 0, col: 0, markdown: "*head*" },
        { op: "styleCell", row: 1, col: 0, from: 0, to: 0, change: { kind: "bold", on: true } },
        { op: "addRow", after: 1 },
        { op: "removeRow", row: 1 },
        { op: "addColumn", after: 0 },
        { op: "removeColumn", col: 0 },
      ),
    }),
  },
);

const CASE = fc.record({ text: NOTE, a: fc.double({ min: 0, max: 1, noNaN: true }), b: fc.double({ min: 0, max: 1, noNaN: true }), w: fc.double({ min: 0, max: 0.999, noNaN: true }), collapsed: fc.boolean(), intent: INTENT, mode: fc.constantFrom<Mode>("rich", "rich", "raw") });

function docOf(c: { text: string; a: number; b: number; collapsed: boolean }): Doc {
  const x = Math.floor(c.a * (c.text.length + 1));
  const y = c.collapsed ? x : Math.floor(c.b * (c.text.length + 1));
  return { text: c.text, sel: { anchor: x, head: y }, typing: { marks: [] } };
}

/** A widget or table intent aimed at one of the note's tasks, photos or tables. */
function aimed(i: Intent, text: string, w: number): Intent {
  const choose = (xs: number[]) => (xs.length ? xs[Math.floor(w * xs.length)] : 0);
  if (i.type === "toggleTask") return { ...i, at: choose([...text.matchAll(/^- \[[ xX]\] /gm)].map((m) => m.index! + 3)) };
  if (i.type === "setImageWidth") return { ...i, at: choose(buildModel(text).chars.flatMap((c, n) => (c.kind === "image" ? [n] : []))) };
  if (i.type === "tableEdit") return { ...i, at: choose(tablesOf(buildModel(text)).map((t) => t.start)) };
  return i;
}

// --- the region, worked out apart from region.ts (7.4.2) --------------------------------------

/**
 * Chunks of the text: runs of lines that are not blank, a fenced code block counting as one
 * run. Every block of 7.4.2 lies inside one chunk, so a region made of chunks holds the region
 * made of blocks: an edit outside it is certainly outside its region.
 */
function chunks(text: string): [number, number][] {
  const out: [number, number][] = [];
  const lines = text.split("\n");
  let pos = 0;
  let cur: [number, number] | null = null;
  let fence: string | null = null;
  for (const line of lines) {
    const end = pos + line.length;
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1] ?? null;
    if (fence === null && f) fence = f;
    else if (fence !== null && f && f[0] === fence[0] && f.length >= fence.length && /^ {0,3}[`~]+[ \t]*$/.test(line)) fence = null;
    const blank = line.trim() === "" && fence === null;
    if (!blank) cur ? (cur[1] = end) : (cur = [pos, end]);
    else if (cur) out.push(cur), (cur = null);
    pos = end + 1;
  }
  if (cur) out.push(cur);
  return out;
}

function looseRegion(text: string, intent: Intent, sel: Doc["sel"]): [number, number] {
  const cs = chunks(text);
  const startOf = (i: number) => (i < 0 ? 0 : i >= cs.length ? text.length : cs[i][0]);
  // A chunk with the blank lines after it, as a block's extent of 7.4.2.
  const around = (lo: number, hi: number): [number, number] => [startOf(lo), startOf(hi + 1)];
  if (intent.type === "setMeta") {
    const m = /^---[ \t]*\n(?:[^\n]*\n)*?---[ \t]*(?:\n|$)/.exec(text);
    return [0, m ? m[0].length : 0];
  }
  // The line under a final table: the last chunk (the table) and what follows it.
  if (intent.type === "lineAfterTable") return [startOf(cs.length - 1), text.length];
  const holding = (p: number) => cs.findIndex(([a, z]) => a <= p && p <= z);
  if (intent.type === "tableEdit" || intent.type === "toggleTask") {
    const i = holding(intent.at);
    return i < 0 ? [intent.at, intent.at] : around(i, i);
  }
  if (intent.type === "setImageWidth") {
    const c = buildModel(text).chars[intent.at];
    const i = c ? holding(c.start) : -1;
    return i < 0 ? [0, 0] : around(i, i);
  }
  const from = Math.min(sel.anchor, sel.head);
  const to = Math.max(sel.anchor, sel.head);
  const touched = cs.flatMap(([a, z], i) => (a <= to && z >= from ? [i] : []));
  if (touched.length === 0) {
    const before = cs.findLastIndex(([, z]) => z < from);
    return around(before, before + 1);
  }
  return around(touched[0] - 1, touched[touched.length - 1] + 1);
}

/**
 * The document for an intent that needs a particular place: a link, a selection inside one
 * block; a line-start shortcut, its marker just typed on a new line at the end, as `insertText`
 * leaves it before its `then` (7.6).
 */
function aimedDoc(intent: Intent, doc: Doc, w: number, mode: Mode): Doc {
  if (intent.type === "setLink") {
    const m = buildModel(doc.text);
    const text = m.chars.flatMap((c, n) => (c.kind === "text" ? [n] : []));
    if (!text.length) return doc;
    const i = text[Math.floor(w * text.length)];
    let j = i;
    while (j + 1 < m.chars.length && m.chars[j + 1].block === m.chars[i].block && j - i < 6) j++;
    return { ...doc, sel: { anchor: m.chars[i].start, head: m.chars[j].end } };
  }
  if (intent.type === "shortcut" && mode === "rich") {
    // The lists' shortcuts, and the marks that are no shortcut any more (SPEC-PLAIN): text. (The
    // generator's numbers lean to 0, so a list comes first.)
    const marker = ["- ", "# ", "1. ", "[] ", "* ", "### ", "> ", "```"][Math.floor(w * 8)];
    let d: Doc = { text: doc.text.replace(/\n*$/, "\n\n"), sel: { anchor: 0, head: 0 }, typing: { marks: [] } };
    d.sel = { anchor: d.text.length, head: d.text.length };
    for (const ch of marker) {
      const r = reduce(d, { type: "insertText", text: ch }, "rich");
      if (!r.ok) return doc;
      d = r.doc;
    }
    return d;
  }
  return doc;
}

const SETTING = (i: Intent) => (i.type === "setMark" && i.change.kind !== "size-step") || i.type === "setList" || i.type === "setLink" || i.type === "setMeta";

test("properties: parses, edit in its region, edit gives the new text, settings are idempotent", () => {
  let refused = 0;
  let outside = 0;
  const done = new Map<string, number>();
  let notIdempotent: string[] = [];
  const made: string[] = [];
  const RUNS = 4000;
  fc.assert(
    fc.property(CASE, (c) => {
      const intent = aimed(c.intent, c.text, c.w);
      const doc = aimedDoc(intent, docOf(c), c.w, c.mode);
      const r = reduce(doc, intent, c.mode);
      if (!r.ok) {
        refused++;
        if (/outside its part/.test(r.reason)) {
          outside++;
          if (process.env.SHOW_OUTSIDE) console.log("OUTSIDE", JSON.stringify(intent), c.mode, JSON.stringify(doc.sel), JSON.stringify(doc.text));
        }
        return true;
      }
      done.set(intent.type, (done.get(intent.type) ?? 0) + 1);
      const label = `${JSON.stringify(intent)} ${c.mode} ${JSON.stringify(doc.sel)} on ${JSON.stringify(doc.text)}`;
      // It parses.
      buildModel(r.doc.text);
      // The edit gives the new text, and lies in its region, worked out apart from reduce's own.
      if (r.edit) {
        assert.equal(doc.text.slice(0, r.edit.from) + r.edit.insert + doc.text.slice(r.edit.to), r.doc.text, label);
        const [lo, hi] = looseRegion(doc.text, intent, doc.sel);
        assert.ok(r.edit.from >= lo && r.edit.to <= hi, `edit ${JSON.stringify(r.edit)} outside [${lo}, ${hi}]: ${label}`);
        assert.equal(r.doc.text.slice(0, lo), doc.text.slice(0, lo), label);
        assert.equal(r.doc.text.slice(r.doc.text.length - (doc.text.length - hi)), doc.text.slice(hi), label);
      } else assert.equal(r.doc.text, doc.text, label);
      // SPEC-PLAIN 5.1: nothing typed or pasted in Rich makes a heading, a quote or a code block.
      if (c.mode === "rich" && (intent.type === "insertText" || intent.type === "paste" || intent.type === "shortcut" || intent.type === "enter" || intent.type === "lineBreak")) {
        const three = (t: string) => {
          const bs = buildModel(t).blocks;
          return [bs.filter((b) => b.info.kind === "heading").length, bs.filter((b) => b.info.kind === "code").length, bs.some((b) => b.info.path.includes("/quote")) ? 1 : 0];
        };
        const [h0, c0, q0] = three(doc.text);
        const [h1, c1, q1] = three(r.doc.text);
        // (Inside one that an older note has, the old rules hold: Enter splits a heading in two.)
        const lo = Math.min(doc.sel.anchor, doc.sel.head);
        const hi = Math.max(doc.sel.anchor, doc.sel.head);
        const inOne = touchedBlocks(buildModel(doc.text), lo, hi).some((b) => b.info.kind === "heading" || b.info.kind === "code" || b.info.path.includes("/quote"));
        if (!inOne && (h1 > h0 || c1 > c0 || q1 > q0)) made.push(label);
      }
      // Both ends of the selection lie in the new text.
      for (const end of [r.doc.sel.anchor, r.doc.sel.head]) assert.ok(Number.isInteger(end) && end >= 0 && end <= r.doc.text.length, `selection ${JSON.stringify(r.doc.sel)}: ${label}`);
      // A setting applied twice is the same as once (from the same selection's new place).
      if (SETTING(intent)) {
        const again = reduce(r.doc, intent, c.mode);
        if (again.ok && again.doc.text !== r.doc.text) notIdempotent.push(`${JSON.stringify(intent)} on ${JSON.stringify(doc.text.slice(0, 80))}`);
        if (process.env.SHOW_IDEM && again.ok && again.doc.text !== r.doc.text) console.log("IDEM", JSON.stringify({ sel: doc.sel, text: doc.text, once: r.doc.text, sel1: r.doc.sel, twice: again.doc.text }));
      }
      return true;
    }),
    { numRuns: RUNS, seed: 20261112 },
  );
  const total = [...done.values()].reduce((a, b) => a + b, 0);
  console.log(`properties: ${total} done, ${refused} refused (${outside} by the region rule), ${notIdempotent.length} settings not idempotent; ${JSON.stringify(Object.fromEntries(done))}`);
  assert.equal(outside, 0, "the region rule refused a routine's own result");
  assert.deepEqual(notIdempotent.slice(0, 5), []);
  assert.deepEqual(made.slice(0, 5), [], "typing or pasting in Rich made a heading, a quote or a code block");
  // The property says something only about intents that were done: most of them, and every kind.
  assert.ok(total >= RUNS / 2, `only ${total} of ${RUNS} intents were done`);
  for (const type of ["insertText", "deleteBackward", "enter", "paste", "setMark", "applyStyle", "shortcut", "setList", "setLink", "insertBlock", "insertPhoto", "setMeta", "toggleTask", "setImageWidth", "tableEdit"]) {
    assert.ok((done.get(type) ?? 0) >= 5, `${type} was done ${done.get(type) ?? 0} times`);
  }
  notIdempotent = [];
});

test("bytes: load then serialize without edits gives the same bytes", () => {
  for (const text of ["a\nb\n", "a\r\nb\r\n", "\ufeffa\nb", "\ufeffa\r\nb\r\n", "", "no ending", "\ufeff"]) {
    const l = load(text);
    assert.ok(!l.text.includes("\r") && !l.text.startsWith("\ufeff"));
    assert.equal(serialize(l.text, l.eol, l.bom), text, JSON.stringify(text));
    assert.equal(l.mixed, false);
  }
  for (const [text, lf] of [["a\r\nb\nc", "a\nb\nc"], ["a\rb", "a\nb"], ["\ufeffa\r\nb\rc\n", "a\nb\nc\n"]]) {
    const l = load(text);
    assert.equal(l.mixed, true);
    assert.equal(l.text, lf);
    assert.equal(serialize(l.text, l.eol, l.bom), (text.startsWith("\ufeff") ? "\ufeff" : "") + lf, "mixed endings and a lone CR become LF");
  }
  fc.assert(
    fc.property(fc.array(fc.string(), { maxLength: 8 }), fc.constantFrom("\n", "\r\n"), fc.boolean(), (lines, eol, bom) => {
      const body = lines.map((l) => l.replace(/[\r\n]/g, "")).join(eol);
      const text = (bom ? "\ufeff" : "") + body;
      const l = load(text);
      if (l.mixed) return true;
      return serialize(l.text, l.eol, l.bom) === text;
    }),
  );
});
