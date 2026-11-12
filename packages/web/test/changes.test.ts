// Findings of the review of alpha's changes (CHANGES-REVIEW-FINDINGS.md) at the level of `web`,
// in Node: CodeMirror's EditorState, the decorations, and the parts of the widgets that are not
// the DOM. Each test names its finding.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorSelection, EditorState } from "@codemirror/state";
import { buildModel, type Intent, type PendingCell } from "../../core/src/index.ts";
import { editorField, richOptions, setRich } from "../src/editor/field.ts";
import { intentSpecs, modeFacet, nearestStop, richInput } from "../src/editor/dispatch.ts";
import { bodyStart, richDecorations } from "../src/editor/decorations.ts";
import { CellFocus } from "../src/editor/table.ts";
import { photoAt } from "../src/editor/widgets.ts";

const opts = { photoUrl: () => null };
const N = "\u00a0";

function make(doc: string, caret = doc.length): EditorState {
  const s = EditorState.create({
    doc,
    selection: EditorSelection.single(caret),
    extensions: [richOptions.of(opts), editorField, modeFacet.of("rich"), ...richInput({ onFiles: () => {}, keepsTyping: () => false })],
  });
  return s.update({ effects: setRich.of(true) }).state;
}

function apply(s: EditorState, intent: Intent): EditorState {
  const r = intentSpecs(s, intent);
  assert.ok(r.ok, `${JSON.stringify(intent)}: ${r.ok ? "" : r.reason}`);
  for (const spec of r.specs) s = s.update(spec).state;
  return s;
}

/** The line classes of Rich mode's decorations, by line start. */
function lineClasses(t: string): Map<number, string> {
  const out = new Map<number, string>();
  richDecorations(buildModel(t), opts).decorations.between(0, t.length, (from, _to, v) => {
    if (v.spec.class && !v.spec.widget && _to === from) out.set(from, `${out.get(from) ?? ""} ${v.spec.class}`.trim());
  });
  return out;
}

/** The hidden ranges of Rich mode (replaced, without a widget). */
function hidden(t: string): [number, number][] {
  const out: [number, number][] = [];
  richDecorations(buildModel(t), opts).atomic.between(0, t.length, (from, to, v) => {
    if (!v.spec.widget) out.push([from, to]);
  });
  return out;
}

test("4: a blank line next to a line holding a kept space is a gap; the kept space's line is text", () => {
  // Lines: "One", "", "", the kept space. The second blank line is next to text.
  const t = `One\n\n\n${N}`;
  const c = lineClasses(t);
  assert.match(c.get(4) ?? "", /rich-gap/);
  assert.match(c.get(5) ?? "", /rich-gap/, "the blank line above the kept space is a gap");
  assert.doesNotMatch(c.get(6) ?? "", /rich-gap/, "the kept space's line is text, not a gap");
});

test("9, 13, 28: two blank lines after the front matter: the first is hidden, the second shown, and the caret stops on it", () => {
  const t = "---\ntitle: T\n---\n\n\nHi";
  const body = bodyStart(buildModel(t));
  assert.equal(body, 18, "after the front matter and one blank line");
  assert.deepEqual(hidden(t).filter(([a]) => a === 0), [[0, body]], "the front matter and one blank line are hidden");
  let s = make(t, 0);
  s = s.update({ selection: EditorSelection.single(2), userEvent: "select.pointer" }).state;
  assert.equal(s.selection.main.head, body, "the first caret stop is the shown blank line");
  assert.equal(nearestStop(s, body), body);
  assert.equal(nearestStop(s, body - 1), body);
  // Backspace on the shown line removes it; then the hidden one is not removed.
  s = apply(s.update({ selection: EditorSelection.single(body + 1) }).state, { type: "deleteBackward" });
  assert.equal(s.doc.toString(), "---\ntitle: T\n---\n\nHi");
  s = apply(s, { type: "deleteBackward" });
  assert.equal(s.doc.toString(), "---\ntitle: T\n---\n\nHi");
});

test("2: Tab or Enter out of a cell whose write is refused stays in the cell, so its text is still tracked", () => {
  type C = { id: string };
  const a: C = { id: "a" };
  let write = false;
  const writes: PendingCell[] = [];
  const focus = new CellFocus<C, { row: number; col: number }>(
    () => ({ row: 1, col: 0, markdown: "typed" }),
    (p) => (writes.push(p), write),
  );
  focus.enter(a);
  assert.equal(focus.move(a, { row: 1, col: 1 }), "refused");
  assert.equal(focus.editing, a, "still the focused cell: what was typed is not lost");
  write = true;
  assert.equal(focus.move(a, { row: 1, col: 1 }), "written");
  assert.equal(focus.editing, null);
  assert.equal(writes.length, 2);
  // An unchanged cell is left.
  const b: C = { id: "b" };
  const same = new CellFocus<C>(() => undefined, () => true);
  same.enter(b);
  assert.equal(same.move(b, null), "unchanged");
  assert.equal(same.editing, null);
});

test("7: the photo a handle belongs to is the one that starts there, also when two photos touch", () => {
  const t = "![](note.assets/a.png)![](note.assets/b.png)";
  const m = buildModel(t);
  assert.equal(photoAt(m, 0), 0);
  assert.equal(photoAt(m, 22), 1, "the second photo, not the first, whose end is there");
  assert.equal(photoAt(buildModel("text"), 0), -1);
});

// --- invisibles (8, 15) -------------------------------------------------------------------------

import { Invisibles, lineEnds, type ViewLike } from "../src/editor/invisibles.ts";
import type { Text } from "@codemirror/state";

/** A view as the plugin reads it: the whole text visible, or the ranges given. */
function stub(state: EditorState, ranges?: { from: number; to: number }[]): ViewLike {
  const all = [{ from: 0, to: state.doc.length }];
  return { state, visibleRanges: ranges ?? all, viewport: { from: 0, to: state.doc.length } } as unknown as ViewLike;
}

/** Every decoration of a set: position and class (a pilcrow is "eol"). */
function listed(set: import("@codemirror/view").DecorationSet): string[] {
  const out: string[] = [];
  for (let c = set.iter(); c.value; c.next()) out.push(`${c.from}-${c.to}:${c.value.spec.class ?? "eol"}`);
  return out;
}

test("8: two visible ranges in one line (a long widget splits it): each line end once, in order", () => {
  const doc = EditorState.create({ doc: "a b ![](note.assets/p.png) c\nnext line\nlast" }).doc;
  // CodeMirror gives ranges like these when a replaced range is long: both in line 1.
  const set = lineEnds(doc, [{ from: 0, to: 4 }, { from: 26, to: 40 }]);
  assert.deepEqual(listed(set), ["28-28:eol", "38-38:eol"]);
  // A plugin whose ranges overlap a line twice does not throw (it did: the builder was given the
  // line again, out of order, and CodeMirror turned the plugin off).
  const v = new Invisibles(stub(EditorState.create({ doc: doc.toString() }), [{ from: 0, to: 4 }, { from: 26, to: 40 }]));
  assert.ok(listed(v.decorations).includes("1-2:inv-space"));
});

test("15: a kept space has its own mark; the last line has no line end, so no pilcrow", () => {
  const v = new Invisibles(stub(EditorState.create({ doc: `a b\n${N}c\td` })));
  assert.deepEqual(listed(v.decorations), ["1-2:inv-space", "3-3:eol", `4-5:inv-nbsp`, "6-7:inv-tab"]);
});

test("15: after a keystroke the marks are looked for again in the changed line only, and are right", () => {
  const lines = Array.from({ length: 60 }, (_, i) => `line ${i} with a few spaces in it`);
  let state = EditorState.create({ doc: lines.join("\n") });
  const v = new Invisibles(stub(state));
  const tr = state.update({ changes: { from: 4, insert: " x" } });
  state = tr.state;
  // Count what the plugin reads of the new text.
  let read = 0;
  const doc = state.doc as Text & { iterRange: Text["iterRange"]; lineAt: Text["lineAt"] };
  const iterRange = doc.iterRange.bind(doc);
  const lineAt = doc.lineAt.bind(doc);
  doc.iterRange = (from: number, to?: number) => ((read += Math.abs((to ?? doc.length) - from)), iterRange(from, to));
  doc.lineAt = (pos: number) => {
    const l = lineAt(pos);
    read += l.length;
    return l;
  };
  v.update({ docChanged: true, viewportChanged: false, viewportMoved: false, changes: tr.changes, startState: tr.startState, state, view: stub(state) });
  assert.ok(read < 3 * lines[0].length, `read ${read} characters of ${state.doc.length}`);
  // The same marks as a fresh build.
  assert.deepEqual(listed(v.decorations), listed(new Invisibles(stub(EditorState.create({ doc: state.doc.toString() }))).decorations));
});

// --- 3. Looks and access (17, 21) ------------------------------------------------------------------

import { readFileSync } from "node:fs";

/** The tokens of tokens.css: light (the first :root) and dark (the prefers-color-scheme block). */
function tokens(): { light: Map<string, string>; dark: Map<string, string> } {
  const css = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
  const at = css.indexOf("@media (prefers-color-scheme: dark)");
  const read = (part: string) => new Map([...part.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2].toLowerCase()]));
  const light = read(css.slice(0, at));
  return { light, dark: new Map([...light, ...read(css.slice(at))]) };
}

function contrast(a: string, b: string): number {
  const lum = (h: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

test("17, 21: every toolbar group's colour passes 4.5:1 in each pairing, light and dark; no two groups share one", () => {
  const svelte = readFileSync(new URL("../src/screens/Toolbar.svelte", import.meta.url), "utf8");
  const used = [...svelte.matchAll(/class="group(?: [a-z]+)* (g\d)"/g)].map((m) => m[1]);
  assert.equal(new Set(used).size, used.length, `each group its own colour: ${used.join(" ")}`);
  const groupVar = (g: string, soft: boolean) => {
    // A group's own rule, or the base `.group` rule for the first.
    const m = new RegExp(`\\.${g} \\{\\s*--g: var\\((--[a-z0-9-]+)\\);\\s*--g-soft: var\\((--[a-z0-9-]+)\\);`).exec(svelte) ?? (g === "g0" ? /\.group \{\s*--g: var\((--[a-z0-9-]+)\);\s*--g-soft: var\((--[a-z0-9-]+)\);/.exec(svelte) : null);
    assert.ok(m, `the colours of .${g}`);
    return soft ? m[2] : m[1];
  };
  const { light, dark } = tokens();
  for (const [name, t] of [["light", light], ["dark", dark]] as const) {
    const colours = new Set<string>();
    for (const g of used) {
      const c = t.get(groupVar(g, false))!;
      const soft = t.get(groupVar(g, true))!;
      colours.add(c);
      // On: --accent-ink on the colour. Hover, the size box, an open menu: the colour on --surface.
      // At rest: --ink on the soft shade.
      for (const [what, fg, bg] of [["on", t.get("--accent-ink")!, c], ["hover", c, t.get("--surface")!], ["rest", t.get("--ink")!, soft]] as const) {
        const r = contrast(fg, bg);
        assert.ok(r >= 4.5, `${name} ${g} ${what}: ${fg} on ${bg} is ${r.toFixed(2)}:1`);
      }
    }
    assert.equal(colours.size, used.length, `${name}: one colour per group`);
  }
});

// --- 22 -----------------------------------------------------------------------------------------

import { readdirSync, statSync } from "node:fs";
import { runCss } from "../src/editor/decorations.ts";
import { cssString } from "../src/lib/fontcss.ts";

test("22: a font name with a quote or a backslash is written into CSS escaped, everywhere", () => {
  const name = `My "odd" \\ font'`;
  const css = runCss({ bold: false, italic: false, strike: false, code: false, underline: false, color: null, bg: null, link: null, size: 12, font: name });
  assert.ok(css.includes(`font-family: ${cssString(name)}`), css);
  // No code writes a font name between quotes by hand (the menu, the runs and the caret did).
  const files: string[] = [];
  const walk = (d: URL) => {
    for (const f of readdirSync(d)) {
      const u = new URL(f, d);
      if (statSync(u).isDirectory()) walk(new URL(`${f}/`, d));
      else if (/\.(ts|svelte)$/.test(f)) files.push(u.pathname);
    }
  };
  walk(new URL("../src/", import.meta.url));
  const bad = files.filter((f) => /font-family: '\$\{/.test(readFileSync(f, "utf8")));
  assert.deepEqual(bad, []);
});
