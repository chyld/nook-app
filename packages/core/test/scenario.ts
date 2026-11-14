// The scenario runner (SPEC2 12): a text with a caret marker `¦` (or a selection from `«` to
// `»`, anchor first), an intent, and the expected text and caret. Pure strings, in Node.

import { reduce, type Doc, type Intent, type Mode, type Typing } from "../src/index.ts";

export const CARET = "¦";

export function parse(marked: string, typing: Typing = { marks: [] }): Doc {
  const c = marked.indexOf(CARET);
  if (c >= 0) {
    const text = marked.slice(0, c) + marked.slice(c + 1);
    return { text, sel: { anchor: c, head: c }, typing };
  }
  const a = marked.indexOf("«");
  const b = marked.indexOf("»");
  if (a < 0 || b < 0) throw new Error(`no caret in ${JSON.stringify(marked)}`);
  // `«` then `»`: anchor at «; `»` then `«` is written as a backward selection.
  const text = marked.replace("«", "").replace("»", "");
  if (a < b) return { text, sel: { anchor: a, head: b - 1 }, typing };
  return { text, sel: { anchor: a - 1, head: b }, typing };
}

export function show(doc: Doc): string {
  const { anchor, head } = doc.sel;
  if (anchor === head) return doc.text.slice(0, head) + CARET + doc.text.slice(head);
  const a = Math.min(anchor, head);
  const b = Math.max(anchor, head);
  const [o, c] = anchor < head ? ["«", "»"] : ["»", "«"];
  return doc.text.slice(0, a) + o + doc.text.slice(a, b) + c + doc.text.slice(b);
}

/** Runs an intent and its `then`, as the editor does. */
export function run(marked: string | Doc, intent: Intent, mode: Mode = "rich"): { out: string; doc: Doc } | { refused: string } {
  const doc = typeof marked === "string" ? parse(marked) : marked;
  const r = reduce(doc, intent, mode);
  if (!r.ok) return { refused: r.reason };
  let d = r.doc;
  if (r.then) {
    const r2 = reduce(d, r.then, mode);
    if (r2.ok) d = r2.doc;
  }
  return { out: show(d), doc: d };
}
