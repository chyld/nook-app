// Pass 1 of SPEC 5 step 4: the scan pass (SPEC 5.1).
//
// One left-to-right scan over the block's inline text, with a stack of open brackets, finds
// code spans, CommonMark autolinks, styled spans, links and images. Whatever the scan
// recognises is consumed and the scan continues after it.

import { isAsciiPunct } from "../chars.ts";
import { parseAttributeList } from "../attributes.ts";
import {
  backtickRunEnd,
  linkLabelLength,
  matchAutolink,
  matchCodeSpan,
  parseLinkDestination,
  parseLinkTitle,
  skipSpnl,
} from "./commonmark.ts";
import { bracketDepth, mergeText, MAX_NESTING, type Definition, type Item, type Scope } from "./items.ts";

interface Bracket {
  /** True for `![`. */
  image: boolean;
  /** Position of the `[` or of the `!` of `![`. */
  pos: number;
  /** Index in the output list of the bracket's own text item. */
  index: number;
  /** CommonMark: another bracket was opened after this one (no shortcut reference then). */
  bracketAfter: boolean;
}

/** Drops the bracket flag of a text item. */
function unmark(it: Item & { bracket?: boolean }): Item {
  if (it.k !== "text") return it;
  return { k: "text", s: it.s, e: it.e };
}

export type LookupDefinition = (label: string) => Definition | null;

export function scanPass(t: string, lookup: LookupDefinition): Scope {
  const n = t.length;
  type Out = Item & { bracket?: boolean };
  const out: Out[] = [];
  const stack: Bracket[] = [];
  // Brackets below these stack heights are, respectively, inactive (CommonMark: a link was found
  // after them, and links cannot contain links; images are never inactive) and have a styled
  // span recognised after them (SPEC 5.1 test 1). Floors instead of flags keep the scan linear.
  let inactiveFloor = 0;
  let spanFloor = 0;
  const pop = () => {
    stack.pop();
    if (inactiveFloor > stack.length) inactiveFloor = stack.length;
    if (spanFloor > stack.length) spanFloor = stack.length;
  };

  const literal = (s: number, e: number) => {
    const last = out[out.length - 1];
    if (last && last.k === "text" && !last.bracket && last.e === s) last.e = e;
    else out.push({ k: "text", s, e });
  };

  /** Removes the items after a bracket (its contents) and the bracket's own item. */
  const takeContents = (b: Bracket): Item[] => {
    const contents = out.splice(b.index);
    contents.shift();
    return mergeText(contents.map(unmark));
  };

  /** SPEC 5.1 test 2: does `]` at `close` with what follows form a link or image? */
  const linkTail = (
    b: Bracket,
    close: number,
  ): {
    end: number;
    destination: string;
    title: string | null;
    kind: "inline" | "reference";
    destStart?: number;
    destEnd?: number;
    definition?: Definition;
  } | null => {
    const p = close + 1;
    if (t[p] === "(") {
      let q = skipSpnl(t, p + 1);
      const destStart = q;
      const dest = parseLinkDestination(t, q);
      if (dest) {
        q = dest.end;
        const afterSpace = skipSpnl(t, q);
        let title: string | null = null;
        if (afterSpace > q) {
          const ti = parseLinkTitle(t, afterSpace);
          if (ti) {
            title = ti.value;
            q = skipSpnl(t, ti.end);
          } else {
            q = afterSpace;
          }
        }
        if (t[q] === ")") {
          return { end: q + 1, destination: dest.value, title, kind: "inline", destStart, destEnd: dest.end };
        }
      }
    }
    // Full, collapsed or shortcut reference.
    const textStart = b.pos + (b.image ? 2 : 1);
    const labelLen = linkLabelLength(t, p);
    let label: string | null = null;
    let end = p;
    if (labelLen > 2) {
      label = t.slice(p + 1, p + labelLen - 1);
      end = p + labelLen;
    } else if (!b.bracketAfter) {
      label = t.slice(textStart, close);
      end = labelLen === 2 ? p + 2 : p;
    }
    if (label === null) return null;
    const def = lookup(label);
    if (!def) return null;
    return { end, destination: def.destination, title: def.title, kind: "reference", definition: def };
  };

  /** Handles an unescaped `]` at `i`; returns the position where the scan continues. */
  const closeBracket = (i: number): number => {
    const b = stack[stack.length - 1];
    if (!b) {
      literal(i, i + 1);
      return i + 1;
    }
    const textStart = b.pos + (b.image ? 2 : 1);
    const index = stack.length - 1;
    const hasSpan = index < spanFloor;
    const active = b.image || index >= inactiveFloor;
    // Nesting limit (MAX_NESTING): content already nested that deep is not wrapped again, and
    // both brackets are literal text.
    let depth = 0;
    const tooDeep = () => {
      depth = bracketDepth(out.slice(b.index + 1)) + 1;
      return depth > MAX_NESTING;
    };
    // 1. Span: opening bracket `[`, `{` of an attribute list right after `]`, text between the
    //    brackets not empty, and no styled span recognised between the brackets.
    if (!b.image && t[i + 1] === "{") {
      const attrs = parseAttributeList(t, i + 1, n);
      if (attrs && i > textStart && !hasSpan) {
        if (tooDeep()) return neither(i);
        const items = takeContents(b);
        pop();
        out.push({ k: "span", s: b.pos, e: attrs.end, scope: { items, start: textStart, end: i }, attrs, depth });
        spanFloor = stack.length;
        return attrs.end;
      }
    }
    // 2. Link or image, by the CommonMark rules.
    if (active) {
      const tail = linkTail(b, i);
      if (tail) {
        if (tooDeep()) return neither(i);
        const items = takeContents(b);
        pop();
        out.push({
          k: b.image ? "image" : "link",
          s: b.pos,
          e: tail.end,
          scope: { items, start: textStart, end: i },
          destination: tail.destination,
          title: tail.title,
          kind: tail.kind,
          destStart: tail.destStart,
          destEnd: tail.destEnd,
          definition: tail.definition,
          depth,
        });
        if (!b.image) inactiveFloor = stack.length;
        return tail.end;
      }
    }
    return neither(i);
  };

  /** 3. Neither: both brackets are literal text. */
  const neither = (i: number): number => {
    pop();
    literal(i, i + 1);
    return i + 1;
  };

  let i = 0;
  while (i < n) {
    const c = t[i];
    if (c === "\\") {
      // A backslash escape makes the next ASCII punctuation character literal (SPEC 5.6).
      const len = i + 1 < n && isAsciiPunct(t[i + 1]) ? 2 : 1;
      literal(i, i + len);
      i += len;
    } else if (c === "`") {
      const code = matchCodeSpan(t, i);
      if (code) {
        out.push({ k: "code", s: i, e: code.end, value: code.value });
        i = code.end;
      } else {
        const e = backtickRunEnd(t, i);
        literal(i, e);
        i = e;
      }
    } else if (c === "<") {
      const auto = matchAutolink(t, i);
      if (auto) {
        out.push({ k: "autolink", s: i, e: auto.end, url: auto.url, email: auto.email });
        i = auto.end;
      } else {
        literal(i, i + 1);
        i++;
      }
    } else if (c === "[" || (c === "!" && t[i + 1] === "[")) {
      const image = c === "!";
      const len = image ? 2 : 1;
      if (stack.length > 0) stack[stack.length - 1].bracketAfter = true;
      stack.push({ image, pos: i, index: out.length, bracketAfter: false });
      out.push({ k: "text", s: i, e: i + len, bracket: true } as Out);
      i += len;
    } else if (c === "]") {
      i = closeBracket(i);
    } else {
      literal(i, i + 1);
      i++;
    }
  }
  // Opening brackets still on the stack are literal text: their items simply stay text.
  return { items: mergeText(out.map(unmark)), start: 0, end: n };
}
