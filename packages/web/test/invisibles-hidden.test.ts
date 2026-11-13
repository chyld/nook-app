// A paragraph with its own font or size is two lines of the file ("Title" and
// "{font=… size=…}") and one line on screen: Rich hides the line end between them together with
// the second line. With invisibles on, that hidden line end must not get a pilcrow, or the
// line shows two.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Text } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { lineEnds } from "../src/editor/invisibles.ts";

const positions = (set: ReturnType<typeof lineEnds>) => {
  const out: number[] = [];
  for (let c = set.iter(); c.value; c.next()) out.push(c.from);
  return out;
};

test("a line end that Rich hides gets no pilcrow", () => {
  const text = "Title\n{size=20pt}\n\nBody";
  const doc = Text.of(text.split("\n"));
  const all = [{ from: 0, to: doc.length }];
  // Raw, or nothing hidden: every line end but the last line's.
  assert.deepEqual(positions(lineEnds(doc, all)), [5, 17, 18]);
  // Rich hides "\n{size=20pt}" (5 to 17): the end at 5 is inside it, the one at 17 follows it.
  const hidden = Decoration.set([Decoration.replace({}).range(5, 17)]);
  assert.deepEqual(positions(lineEnds(doc, all, hidden)), [17, 18]);
  // A mark that only styles the text hides nothing.
  const styled = Decoration.set([Decoration.mark({ class: "x" }).range(0, 17)]);
  assert.deepEqual(positions(lineEnds(doc, all, styled)), [5, 17, 18]);
});
