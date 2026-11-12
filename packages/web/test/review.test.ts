// Findings of section 3 of the version 2 code review in `web` that need no browser: CodeMirror's
// EditorState in Node, and the stores with the fake API client. Each test names its finding.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import type { Intent } from "../../core/src/index.ts";
import { editorField, richOptions, setRich } from "../src/editor/field.ts";
import { intentSpecs, modeFacet, richInput } from "../src/editor/dispatch.ts";

function make(doc: string): EditorState {
  const s = EditorState.create({
    doc,
    selection: EditorSelection.single(doc.length),
    extensions: [richOptions.of({ photoUrl: () => null }), editorField, modeFacet.of("rich"), ...richInput({ onFiles: () => {}, keepsTyping: () => false }), history()],
  });
  return s.update({ effects: setRich.of(true) }).state;
}
function apply(s: EditorState, intent: Intent): EditorState {
  const r = intentSpecs(s, intent);
  assert.ok(r.ok, `${JSON.stringify(intent)}: ${r.ok ? "" : r.reason}`);
  for (const spec of r.specs) s = s.update(spec).state;
  return s;
}
function undone(s: EditorState): string {
  let out = s;
  undo({ state: s, dispatch: (tr: Transaction) => (out = tr.state) });
  return out.doc.toString();
}

test("26 (not a fault, kept as a guard): a style chosen with nothing selected between two typed letters splits the undo step", () => {
  for (const i of [{ type: "setMark", change: { kind: "bold", on: true } }, { type: "setMark", change: { kind: "color", value: "red" } }, { type: "setMark", change: { kind: "size", pt: 14 } }] as Intent[]) {
    let s = make("x ");
    s = apply(s, { type: "insertText", text: "a" });
    s = apply(s, i);
    s = apply(s, { type: "insertText", text: "b" });
    assert.match(s.doc.toString(), /b/);
    assert.equal(undone(s), "x a", `${JSON.stringify(i)}: undo takes back only what was typed after it`);
  }
  // A block chosen on an empty line, then typing: the typing is one step.
  let s = make("x\n\n");
  s = apply(s, { type: "setBlock", kind: "h2" });
  s = apply(s, { type: "insertText", text: "a" });
  assert.equal(s.doc.toString(), "x\n\n## a");
  assert.equal(undone(s), "x\n\n");
});

// --- 35a: font search answers that arrive late ---

import { setClient, type ApiClient } from "../src/lib/api.ts";
import { fonts } from "../src/stores/fonts.svelte.ts";
import { FakeApi } from "./fake.ts";

test("35a: an older font search answering late does not replace or extend a newer one", async () => {
  const held: { q: string; offset: number; answer: () => void }[] = [];
  const family = (q: string, i: number) => ({ family: `${q} ${i}`, slug: `${q}-${i}`, category: "sans-serif" });
  const client: ApiClient = {
    ...new FakeApi().client(),
    catalogue: (q) =>
      new Promise((ok) => {
        const name = q.q ?? "all";
        const offset = q.offset ?? 0;
        held.push({ q: name, offset, answer: () => ok({ families: [family(name, offset), family(name, offset + 1)], total: 10, categories: [], available: true }) });
      }),
  };
  setClient(client);
  const first = fonts.browse("old", "");
  const more = fonts.more();
  const second = fonts.browse("new", "");
  held.find((h) => h.q === "new")!.answer();
  await second;
  for (const h of held.filter((x) => x.q === "old")) h.answer();
  await first;
  await more;
  assert.deepEqual(fonts.families.map((f) => f.family), ["new 0", "new 1"]);
});
