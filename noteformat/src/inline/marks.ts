// Pass 2 of SPEC 5 step 4: the mark pass (SPEC 5.2), `++underline++` and `==highlight==`.

import { charAt, charBefore, isAsciiPunct, isLetterOrDigit, isWhitespace } from "../chars.ts";
import { scopeOf, sliceItems, type Item, type MarkItem, type Scope } from "./items.ts";

interface Run {
  ch: "+" | "=";
  s: number;
  e: number;
  canOpen: boolean;
  canClose: boolean;
}

/** Applies the mark pass to a scope and, first, to every scope nested in it. */
export function markPass(scope: Scope, t: string): void {
  for (const it of scope.items) {
    const inner = scopeOf(it);
    if (inner) markPass(inner, t);
  }
  marksInScope(scope, t);
}

/**
 * The delimiter runs of one scope: maximal sequences of unescaped `+` or of unescaped `=` in its
 * literal text. Only runs of exactly two characters can be delimiters.
 */
function findRuns(scope: Scope, t: string): Run[] {
  const runs: Run[] = [];
  for (const it of scope.items) {
    if (it.k !== "text") continue;
    let j = it.s;
    while (j < it.e) {
      const c = t[j];
      if (c === "\\" && j + 1 < it.e && isAsciiPunct(t[j + 1])) {
        j += 2;
        continue;
      }
      if (c === "+" || c === "=") {
        let m = j;
        while (m < it.e && t[m] === c) m++;
        if (m - j === 2) {
          // A run at the very start of its scope has no character before it, and a run at the
          // very end none after it. A missing character is neither whitespace nor a letter or
          // digit.
          const atStart = j === scope.start;
          const atEnd = m === scope.end;
          const before = atStart ? "" : charBefore(t, j);
          const after = atEnd ? "" : charAt(t, m);
          const canOpen = !atEnd && !isWhitespace(after) && !(before !== "" && isLetterOrDigit(before));
          const canClose = !atStart && !isWhitespace(before) && !(after !== "" && isLetterOrDigit(after));
          runs.push({ ch: c, s: j, e: m, canOpen, canClose });
        }
        j = m;
        continue;
      }
      j++;
    }
  }
  return runs;
}

function marksInScope(scope: Scope, t: string): void {
  const runs = findRuns(scope, t);
  // The first run that can open pairs with the next run of the same character that can close
  // and has at least one character between them. Runs between the two are not paired at this
  // level; pairing continues after the closing run. A run without a partner is literal.
  // nextClose[ch][i]: the first run after run i of character ch that can close (runs never
  // touch, so there is always at least one character between two runs).
  const nextClose: Record<string, number[]> = { "+": new Array(runs.length), "=": new Array(runs.length) };
  let plus = runs.length;
  let equals = runs.length;
  for (let k = runs.length - 1; k >= 0; k--) {
    nextClose["+"][k] = plus;
    nextClose["="][k] = equals;
    if (runs[k].canClose) {
      if (runs[k].ch === "+") plus = k;
      else equals = k;
    }
  }
  const pairs: [Run, Run][] = [];
  let i = 0;
  while (i < runs.length) {
    const open = runs[i];
    if (open.canOpen) {
      const j = nextClose[open.ch][i];
      if (j < runs.length) {
        pairs.push([open, runs[j]]);
        i = j + 1;
        continue;
      }
    }
    i++;
  }
  if (pairs.length === 0) return;
  const items: Item[] = [];
  let cursor = scope.start;
  for (const [open, close] of pairs) {
    items.push(...sliceItems(scope.items, cursor, open.s));
    // The content of a mark is an inline scope, and the mark pass is applied to it.
    const inner: Scope = { items: sliceItems(scope.items, open.e, close.s), start: open.e, end: close.s };
    marksInScope(inner, t);
    const mark: MarkItem = { k: "mark", ch: open.ch, s: open.s, e: close.e, scope: inner };
    items.push(mark);
    cursor = close.e;
  }
  items.push(...sliceItems(scope.items, cursor, scope.end));
  scope.items = items;
}
