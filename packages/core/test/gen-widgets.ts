// Notes for the property test that also hold what version 1's generator (gen.ts, ported and
// left as it is) never makes: tables, photos and task lists (version 2 code review, 37).

import { genNote } from "./gen.ts";

export function genWidgetNote(r: () => number): string {
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  const base = genNote(r).replace(/\n$/, "");
  const parts = base.split("\n\n");
  const extra: string[] = [];
  if (r() < 0.5) extra.push(pick(["| a | b |\n|---|---|\n| c | **d** |", "| one |\n| --- |\n| two |\n| three |", "| x | y | z |\n|:--|:-:|--:|\n|  | *e* | f |"]));
  if (r() < 0.4) extra.push(pick(["![](note.assets/p.png)", "![](note.assets/q.jpg)\n{width=40%}", "Before ![](note.assets/p.png) after"]));
  if (r() < 0.4) extra.push(pick(["- [ ] one\n- [x] two", "- [x] done", "1. a\n2. b\n\n- [ ] later"]));
  for (const e of extra) parts.splice(Math.floor(r() * (parts.length + 1)), 0, e);
  // Front matter, when the base note has it, stays first.
  const fm = parts.findIndex((p) => p.startsWith("---\n"));
  if (fm > 0) parts.unshift(...parts.splice(fm, 1));
  return parts.join("\n\n") + (r() < 0.5 ? "\n" : "");
}
