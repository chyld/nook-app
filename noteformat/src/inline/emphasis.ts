// Pass 4 of SPEC 5 step 4: the emphasis pass. Emphasis and strong emphasis by CommonMark 0.31.2
// ("process emphasis", spec appendix), and GFM strikethrough with one or two tildes, in each
// inline scope.

import { charAt, charBefore, isAsciiPunct, isPunctuation, isWhitespace } from "../chars.ts";
import { MAX_NESTING, mergeText, scopeOf, type Item, type Scope } from "./items.ts";

interface Cell {
  item: Item;
  prev: Cell | null;
  next: Cell | null;
}

interface Delim {
  ch: "*" | "_" | "~";
  cell: Cell & { item: { k: "text"; s: number; e: number } };
  origLen: number;
  len: number;
  canOpen: boolean;
  canClose: boolean;
  prev: Delim | null;
  next: Delim | null;
}

export function emphasisPass(scope: Scope, t: string): void {
  for (const it of scope.items) {
    const inner = scopeOf(it);
    if (inner) emphasisPass(inner, t);
  }
  emphasisInScope(scope, t);
}

function emphasisInScope(scope: Scope, t: string): void {
  // The scope's items as a linked list; each delimiter run becomes a text cell of its own.
  let first: Cell | null = null;
  let last: Cell | null = null;
  const append = (item: Item): Cell => {
    const cell: Cell = { item, prev: last, next: null };
    if (last) last.next = cell;
    else first = cell;
    last = cell;
    return cell;
  };
  let dFirst: Delim | null = null;
  let dLast: Delim | null = null;

  for (const it of scope.items) {
    if (it.k !== "text") {
      append(it);
      continue;
    }
    let j = it.s;
    let textStart = it.s;
    while (j < it.e) {
      const c = t[j];
      if (c === "\\" && j + 1 < it.e && isAsciiPunct(t[j + 1])) {
        j += 2;
        continue;
      }
      if (c !== "*" && c !== "_" && c !== "~") {
        j++;
        continue;
      }
      let m = j;
      while (m < it.e && t[m] === c) m++;
      const len = m - j;
      // GFM strikethrough uses one or two tildes; a longer run is literal text.
      if (c === "~" && len > 2) {
        j = m;
        continue;
      }
      // Flanking looks at the characters next to the run in the source text (SPEC 5); the
      // start and end of the block count as whitespace (CommonMark).
      const before = j === 0 ? "\n" : charBefore(t, j);
      const after = m >= t.length ? "\n" : charAt(t, m);
      const bWs = isWhitespace(before);
      const aWs = isWhitespace(after);
      const bP = isPunctuation(before);
      const aP = isPunctuation(after);
      const left = !aWs && (!aP || bWs || bP);
      const right = !bWs && (!bP || aWs || aP);
      let canOpen: boolean;
      let canClose: boolean;
      if (c === "_") {
        canOpen = left && (!right || bP);
        canClose = right && (!left || aP);
      } else {
        canOpen = left;
        canClose = right;
      }
      if (canOpen || canClose) {
        if (j > textStart) append({ k: "text", s: textStart, e: j });
        const cell = append({ k: "text", s: j, e: m }) as Delim["cell"];
        const d: Delim = { ch: c, cell, origLen: len, len, canOpen, canClose, prev: dLast, next: null };
        if (dLast) dLast.next = d;
        else dFirst = d;
        dLast = d;
        textStart = m;
      }
      j = m;
    }
    if (textStart < it.e) append({ k: "text", s: textStart, e: it.e });
  }

  const removeDelim = (d: Delim) => {
    if (d.prev) d.prev.next = d.next;
    else dFirst = d.next;
    if (d.next) d.next.prev = d.prev;
    else dLast = d.prev;
  };
  const removeCell = (c: Cell) => {
    if (c.prev) c.prev.next = c.next;
    else first = c.next;
    if (c.next) c.next.prev = c.prev;
    else last = c.prev;
  };

  // process emphasis
  const openersBottom = new Map<string, Delim | null>();
  const bottomKey = (d: Delim) => (d.ch === "~" ? `~${d.origLen}` : `${d.ch}${d.canOpen ? 1 : 0}${d.origLen % 3}`);
  let closer: Delim | null = dFirst;
  while (closer) {
    if (!closer.canClose) {
      closer = closer.next;
      continue;
    }
    const key = bottomKey(closer);
    const bottom = openersBottom.get(key) ?? null;
    let opener: Delim | null = closer.prev;
    let found = false;
    while (opener && opener !== bottom) {
      if (opener.ch === closer.ch && opener.canOpen) {
        if (closer.ch === "~") {
          if (opener.len === closer.len) {
            found = true;
            break;
          }
        } else {
          const oddMatch =
            (closer.canOpen || opener.canClose) &&
            closer.origLen % 3 !== 0 &&
            (opener.origLen + closer.origLen) % 3 === 0;
          if (!oddMatch) {
            found = true;
            break;
          }
        }
      }
      opener = opener.prev;
    }
    // Nesting limit (MAX_NESTING): content already nested that deep is not wrapped again.
    let depth = 1;
    if (found && opener) {
      for (let c = opener.cell.next; c && c !== closer.cell; c = c.next) {
        const it = c.item;
        if ((it.k === "emph" || it.k === "strong" || it.k === "del") && it.depth + 1 > depth) depth = it.depth + 1;
      }
      if (depth > MAX_NESTING) found = false;
    }
    if (!found || !opener) {
      openersBottom.set(key, closer.prev);
      const next: Delim | null = closer.next;
      if (!closer.canOpen) removeDelim(closer);
      closer = next;
      continue;
    }
    const use = closer.ch === "~" ? closer.len : closer.len >= 2 && opener.len >= 2 ? 2 : 1;
    opener.len -= use;
    closer.len -= use;
    opener.cell.item.e -= use;
    closer.cell.item.s += use;
    // Move the cells between opener and closer into the new node.
    const children: Item[] = [];
    let c = opener.cell.next;
    while (c && c !== closer.cell) {
      children.push(c.item);
      c = c.next;
    }
    const node: Item = {
      k: closer.ch === "~" ? "del" : use === 2 ? "strong" : "emph",
      s: opener.cell.item.e,
      e: closer.cell.item.s,
      items: mergeText(children),
      depth,
    };
    const nodeCell: Cell = { item: node, prev: opener.cell, next: closer.cell };
    opener.cell.next = nodeCell;
    closer.cell.prev = nodeCell;
    // Delimiters between the two are removed; their text stays literal.
    opener.next = closer;
    closer.prev = opener;
    if (opener.len === 0) {
      removeCell(opener.cell);
      removeDelim(opener);
    }
    if (closer.len === 0) {
      const next: Delim | null = closer.next;
      removeCell(closer.cell);
      removeDelim(closer);
      closer = next;
    }
  }

  const items: Item[] = [];
  for (let c = first as Cell | null; c; c = c.next) items.push(c.item);
  scope.items = mergeText(items);
}
