// SPEC2 12, editor state: undo and redo after each kind of intent, and typing grouped into one
// step; composition, including one that replaces a selection and one that is refused; `typing`
// cleared by a key move and kept by a click; the caret kept at stops after undo and a mode
// switch; and what version 1's `rich-display` test checked. CodeMirror's EditorState in Node.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Compartment, EditorSelection, EditorState, Transaction, type TransactionSpec } from "@codemirror/state";
import { history, redo, undo } from "@codemirror/commands";
import { buildModel, PLAIN, type Intent } from "../../core/src/index.ts";
import { editorField, richOptions, setRich, setTyping } from "../src/editor/field.ts";
import { atStops, compositionSpec, intentSpecs, modeFacet, nearestStop, remember, richInput } from "../src/editor/dispatch.ts";
import { richDecorations } from "../src/editor/decorations.ts";

const opts = { photoUrl: () => null };

function make(doc: string, mode: "rich" | "raw" = "rich", caret = doc.length): EditorState {
  const s = EditorState.create({
    doc,
    selection: EditorSelection.single(caret),
    extensions: [
      richOptions.of(opts),
      editorField,
      modeFacet.of(mode),
      ...(mode === "rich" ? richInput({ onFiles: () => {}, keepsTyping: () => false }) : []),
      history({ joinToEvent: (tr, adjacent) => adjacent && !tr.isUserEvent("input.type.compose.start") }),
    ],
  });
  return mode === "rich" ? s.update({ effects: setRich.of(true) }).state : s;
}

function apply(s: EditorState, intent: Intent, sel?: { anchor: number; head: number }): EditorState {
  const r = intentSpecs(s, intent, sel ? { sel } : {});
  assert.ok(r.ok, `${JSON.stringify(intent)}: ${r.ok ? "" : r.reason}`);
  for (const spec of r.specs) s = s.update(spec).state;
  return s;
}

function cmd(s: EditorState, f: typeof undo): EditorState {
  let out = s;
  f({ state: s, dispatch: (tr: Transaction) => (out = tr.state) });
  return out;
}

const text = (s: EditorState) => s.doc.toString();
const sel = (s: EditorState) => [s.selection.main.anchor, s.selection.main.head];

test("undo and redo after each kind of intent: one step each", () => {
  const cases: [string, Intent, [number, number]?][] = [
    ["one two", { type: "setMark", change: { kind: "bold", on: true } }, [4, 7]],
    ["one two", { type: "setBlock", kind: "h2" }],
    ["one two", { type: "setList", kind: "bullet" }],
    ["one two", { type: "setLink", href: "https://e.com" }, [0, 3]],
    ["one two", { type: "insertBlock", what: "rule" }],
    ["one two", { type: "insertPhoto", file: "p.png" }],
    ["one two", { type: "enter" }],
    ["one two", { type: "lineBreak" }, [3, 3]],
    ["one two", { type: "paste", plain: "a\nb" }],
    ["one two", { type: "deleteBackward" }],
    ["one two", { type: "cut" }, [0, 3]],
    ["one two", { type: "setMeta", key: "title", value: "Hi" }],
    ["- [ ] task", { type: "toggleTask", at: 2 }],
    ["![](note.assets/p.png)\n\nx", { type: "setImageWidth", at: 0, value: 40 }],
    ["one two", { type: "applyStyle", style: { name: "s", bold: true, italic: true, underline: false, strike: false, size: null, font: null, color: "red", bg: null } }, [0, 3]],
    ["| a | b |\n|---|---|\n| c | d |\n\nx", { type: "tableEdit", at: 0, op: { op: "setCell", row: 1, col: 0, runs: [{ text: "new", style: PLAIN }] } }],
    ["| a | b |\n|---|---|\n| c | d |\n\nx", { type: "tableEdit", at: 0, op: { op: "addRow", after: 1 }, pending: { row: 1, col: 1, runs: [{ text: "typed", style: PLAIN }] } }],
  ];
  for (const [doc, intent, range] of cases) {
    let s = make(doc);
    if (range) s = s.update({ selection: EditorSelection.single(range[0], range[1]) }).state;
    const after = apply(s, intent);
    assert.notEqual(text(after), doc, JSON.stringify(intent));
    const back = cmd(after, undo);
    assert.equal(text(back), doc, `undo ${JSON.stringify(intent)}`);
    assert.equal(text(cmd(back, redo)), text(after), `redo ${JSON.stringify(intent)}`);
  }
});

test("typing is grouped into one undo step; another intent is its own step on both sides", () => {
  let s = make("x ");
  for (const ch of "abc") s = apply(s, { type: "insertText", text: ch });
  assert.equal(text(s), "x abc");
  assert.equal(text(cmd(s, undo)), "x ", "typing is one step");
  s = s.update({ selection: EditorSelection.single(2, 5) }).state;
  s = apply(s, { type: "setMark", change: { kind: "bold", on: true } });
  s = s.update({ selection: EditorSelection.single(text(s).length) }).state;
  s = apply(s, { type: "insertText", text: "d" });
  assert.equal(text(s), "x **abcd**", "typed text keeps the style of the character before it");
  s = cmd(s, undo);
  assert.equal(text(s), "x **abc**", "typing after a style does not join it");
  s = cmd(s, undo);
  assert.equal(text(s), "x abc");
  // A line-start shortcut is its own step after the typed characters.
  let t = make("");
  t = apply(t, { type: "insertText", text: "#" });
  t = apply(t, { type: "insertText", text: " " });
  assert.equal(text(t), "# ");
  t = cmd(t, undo);
  assert.equal(text(t), "\\# ");
});

/** Simulates CodeMirror's own composition transactions, then the finish of section 8. */
function compose(s: EditorState, steps: string[]): { before: ReturnType<typeof remember>; state: EditorState } {
  const before = remember(s);
  const from = s.selection.main.from;
  let to = s.selection.main.to;
  steps.forEach((t, i) => {
    s = s.update({ changes: { from, to, insert: t }, selection: EditorSelection.single(from + t.length), userEvent: i === 0 ? "input.type.compose.start" : "input.type.compose" }).state;
    to = from + t.length;
  });
  return { before, state: s };
}

test("composition: the composed text is reduced as insertText; the whole composition is one undo step", () => {
  let s = make("Hello **world**");
  s = apply(s, { type: "insertText", text: "!" });
  s = s.update({ selection: EditorSelection.single(6) }).state;
  const c = compose(s, ["ㅎ", "하", "한"]);
  assert.equal(text(c.state), "Hello 한**world!**");
  const r = compositionSpec(c.before, c.state);
  assert.ok(r && !r.refused);
  s = c.state.update(r!.spec).state;
  assert.equal(text(s), "Hello 한**world!**");
  s = cmd(s, undo);
  assert.equal(text(s), "Hello **world!**", "undo goes back to the remembered text in one step, not past it");
  s = cmd(s, undo);
  assert.equal(text(s), "Hello **world**");
});

test("composition over a selection, and inside bold: the result is the reduced text", () => {
  let s = make("Hello world");
  s = s.update({ selection: EditorSelection.single(6, 11) }).state;
  let c = compose(s, ["t", "th", "there"]);
  let r = compositionSpec(c.before, c.state)!;
  s = c.state.update(r.spec).state;
  assert.equal(text(s), "Hello there");
  assert.equal(text(cmd(s, undo)), "Hello world");
  // Typed at the end of bold, it is bold (the routine's text, not CodeMirror's).
  s = make("**bold**", "rich", 6);
  c = compose(s, ["x"]);
  r = compositionSpec(c.before, c.state)!;
  s = c.state.update(r.spec).state;
  assert.equal(text(s), "**boldx**");
  assert.equal(text(cmd(s, undo)), "**bold**");
});

test("a refused composition puts the remembered text back", () => {
  let s = make("```\ncode\n```", "rich", 1);
  const c = compose(s, ["x"]);
  const r = compositionSpec(c.before, c.state)!;
  assert.ok(r.refused, "refused");
  s = c.state.update(r.spec).state;
  assert.equal(text(s), "```\ncode\n```");
});

test("typing is cleared by a key move or a selection, kept by a plain click; cleared by undo", () => {
  let s = make("one two", "rich", 7);
  s = apply(s, { type: "setMark", change: { kind: "bold", on: true } });
  assert.equal(s.field(editorField).typing.marks.length, 1);
  const click = s.update({ selection: EditorSelection.single(3), userEvent: "select.pointer" }).state;
  assert.equal(click.field(editorField).typing.marks.length, 1, "a plain click keeps it");
  const key = s.update({ selection: EditorSelection.single(3), userEvent: "select" }).state;
  assert.equal(key.field(editorField).typing.marks.length, 0, "a key move clears it");
  const drag = s.update({ selection: EditorSelection.single(0, 3), userEvent: "select.pointer" }).state;
  assert.equal(drag.field(editorField).typing.marks.length, 0, "selecting text clears it");
  // A space typed alone keeps it waiting; the next letter takes it.
  let t = apply(s, { type: "insertText", text: " " });
  assert.equal(t.field(editorField).typing.marks.length, 1);
  t = apply(t, { type: "insertText", text: "x" });
  assert.equal(text(t), "one two **x**");
  assert.equal(t.field(editorField).typing.marks.length, 0);
  const u = cmd(t, undo);
  assert.equal(u.field(editorField).typing.marks.length, 0, "undo clears it");
  const fx = s.update({ effects: setTyping.of({ marks: [], block: "h2" }) }).state;
  assert.equal(fx.field(editorField).typing.block, "h2");
});

test("Rich mode's filter drops a change that is not an intent; lets undo, a load and a composition through", () => {
  const s = make("x **b** y");
  assert.equal(text(s.update({ changes: { from: 0, insert: "**" } }).state), "x **b** y", "dropped");
  assert.equal(text(s.update({ changes: { from: 0, insert: "z" }, userEvent: "input.type.compose" }).state), "zx **b** y");
  const raw = make("x **b** y", "raw");
  assert.equal(text(raw.update({ changes: { from: 0, insert: "**" } }).state), "**x **b** y", "Raw typing is plain");
});

test("the caret is kept at stops: after a click, an undo and a switch to Rich", () => {
  let s = make("x **bold** y", "rich", 0);
  // Strictly inside the hidden `**`: to the nearest stop, the lower on a tie.
  s = s.update({ selection: EditorSelection.single(3), userEvent: "select.pointer" }).state;
  assert.deepEqual(sel(s), [2, 2]);
  assert.equal(nearestStop(s, 9), 8);
  // Before the body of a note with front matter.
  let f = make("---\ntitle: T\n---\n\nBody", "rich", 0);
  f = f.update({ selection: EditorSelection.single(5) }).state;
  assert.deepEqual(sel(f), [18, 18]);
  // After an undo that restores a selection inside hidden markup (review, 41: the case before
  // had none): the caret was left in `**` in Raw, a change was made there, the view switched to
  // Rich, and the undo brings back the selection from before the change.
  const slot = new Compartment();
  const richExt = [modeFacet.of("rich" as const), ...richInput({ onFiles: () => {}, keepsTyping: () => false })];
  let u = EditorState.create({ doc: "x **bold** y", selection: EditorSelection.single(3), extensions: [richOptions.of(opts), editorField, slot.of(modeFacet.of("raw")), history()] });
  u = u.update({ changes: { from: 12, insert: "z" }, selection: EditorSelection.single(13), userEvent: "input.type" }).state;
  u = u.update({ effects: [slot.reconfigure(richExt), setRich.of(true)] }).state;
  u = cmd(u, atStops(undo));
  assert.equal(text(u), "x **bold** y");
  assert.deepEqual(sel(u), [2, 2], "the restored selection, inside the hidden `**`, moved to the stop before it");
  // The switch to Rich: a selection end in hidden markup moves.
  let r = make("x **bold** y", "raw", 3);
  assert.deepEqual(sel(r), [3, 3]);
  r = EditorState.create({ doc: text(r), selection: r.selection, extensions: [richOptions.of(opts), editorField, modeFacet.of("rich"), ...richInput({ onFiles: () => {}, keepsTyping: () => false })] });
  r = r.update({ effects: setRich.of(true) }).state;
  r = r.update({ selection: r.selection }).state;
  assert.deepEqual(sel(r), [2, 2]);
});

// --- what version 1's rich-display test checked ---------------------------------------------------

const demo = JSON.parse(readFileSync(new URL("../../core/test/fixtures/demo-notes.json", import.meta.url), "utf8")) as { name: string; text: string }[];

function shown(t: string): string {
  const { decorations } = richDecorations(buildModel(t), opts);
  const ranges: [number, number, { text?: string; alt?: string } | undefined][] = [];
  decorations.between(0, t.length, (from, to, value) => {
    if (value.point && to > from) ranges.push([from, to, value.spec.widget]);
  });
  ranges.sort((a, b) => a[0] - b[0]);
  const parts: string[] = [];
  let pos = 0;
  for (const [from, to, w] of ranges) {
    assert.ok(from >= pos, `overlapping hidden ranges at ${from}`);
    parts.push(t.slice(pos, from));
    parts.push(w ? (w.text ?? w.alt ?? "") : "");
    pos = to;
  }
  parts.push(t.slice(pos));
  return parts.join("");
}

const squash = (s: string) => s.replace(/\s+/g, "");
const visible = (t: string) => buildModel(t).chars.map((c) => (c.kind === "soft" ? " " : c.kind === "hard" ? "\n" : c.kind === "image" ? c.image!.alt : c.ch)).join("");
const unmark = (s: string) => s.replace(/[•☐☑]|\b\d{1,9}[.)] /g, " ");

test("the demo notes show exactly their visible text, and no markup (tables are widgets)", () => {
  for (const n of demo) {
    if (/^\|/m.test(n.text)) continue;
    assert.equal(squash(unmark(shown(n.text))), squash(unmark(visible(n.text))), n.name);
  }
});

test("markup is hidden: emphasis, spans, attribute lines, headings, quotes, lists, front matter", () => {
  const cases: [string, string][] = [
    ["# Title\n{color=red}\n\nSome **bold** and [red]{color=red} text.", "Title\n\nSome bold and red text."],
    ["---\nid: abc\ntitle: x\n---\n\nHello ==there== ++you++", "Hello there you"],
    ["> quoted\n> more", "quoted more"],
    ["- one\n- [ ] two\n1. three", "•one\ntwo\n1.three"],
    ["a\\*b &amp; c", "a*b & c"],
    ["Setext\n======", "Setext"],
    ["```js\ncode *x*\n```", "code *x*"],
    ["line one  \nline two", "line one\nline two"],
    ["[link](https://example.com \"t\") and <https://a.example>", "link and https://a.example"],
    ["![alt text](p.png)\n{width=50%}", "alt text"],
    ["[ref][r]\n\n[r]: /x", "ref\n\n"],
  ];
  for (const [src, want] of cases) assert.equal(shown(src), want, JSON.stringify(src));
});

test("a styled run gets the reading view's style", () => {
  const { decorations } = richDecorations(buildModel("a **b** [c]{color=red size=18pt}"), opts);
  const marks: string[] = [];
  decorations.between(0, 40, (_f, _t, v) => {
    if (!v.point && v.spec.attributes?.style) marks.push(v.spec.attributes.style);
  });
  assert.deepEqual(marks, ["font-size: 12pt", "font-size: 12pt; font-weight: 700", "font-size: 12pt", "font-size: 18pt; color: var(--note-red)"]);
});

test("the field is rebuilt in the same transaction, from the intent's model (no second parse)", () => {
  const s = make("x **b** y");
  const r = intentSpecs(s, { type: "insertText", text: "z" });
  assert.ok(r.ok);
  const spec = r.specs[0] as TransactionSpec & { effects: { value: unknown }[] };
  const given = spec.effects[0].value;
  const after = s.update(r.specs[0]).state;
  assert.equal(after.field(editorField).model, given, "the model the intent returned is the one used");
  // Moving the selection alone does not rebuild.
  const moved = after.update({ selection: EditorSelection.single(0) }).state;
  assert.equal(moved.field(editorField).model, after.field(editorField).model);
});

test("speed: each demo note is turned into decorations well within 50 ms", () => {
  for (const n of demo) {
    richDecorations(buildModel(n.text + " "), opts);
    const t = performance.now();
    richDecorations(buildModel(n.text + "  "), opts);
    const ms = performance.now() - t;
    assert.ok(ms < 50, `${n.name}: ${ms.toFixed(1)} ms`);
  }
  void Transaction;
});
