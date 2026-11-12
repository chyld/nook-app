// SPEC 5 step 4: the inline text of a block is parsed in four passes, then turned into the
// public syntax tree.

import { isAsciiPunct } from "../chars.ts";
import { matchEntity } from "../entities.ts";
import type { AttributeList, Inline, Range } from "../types.ts";
import { bareUrlPass } from "./bareurls.ts";
import { emphasisPass } from "./emphasis.ts";
import { MAX_TREE_DEPTH, type InlineInput, type Item } from "./items.ts";
import { markPass } from "./marks.ts";
import { scanPass, type LookupDefinition } from "./scan.ts";

export type { InlineInput } from "./items.ts";
export type { LookupDefinition } from "./scan.ts";

export function parseInline(input: InlineInput, lookup: LookupDefinition): Inline[] {
  const t = input.text;
  const root = scanPass(t, lookup); // 1. scan pass
  markPass(root, t); // 2. mark pass
  bareUrlPass(root, t); // 3. bare URL pass
  emphasisPass(root, t); // 4. emphasis pass
  return new Builder(input).nodes(root.items);
}

class Builder {
  input: InlineInput;

  constructor(input: InlineInput) {
    this.input = input;
  }

  /** Source range of the text positions [a, b). */
  range(a: number, b: number): Range {
    const { offsets, source } = this.input;
    const start = offsets[a];
    if (b <= a) return { start, end: start };
    const last = offsets[b - 1];
    const crlf = source.charCodeAt(last) === 0x0d && source.charCodeAt(last + 1) === 0x0a;
    return { start, end: last + (crlf ? 2 : 1) };
  }

  /** Current depth below the block, for the MAX_TREE_DEPTH guard. */
  depth = 0;

  nodes(items: Item[]): Inline[] {
    this.depth++;
    try {
      return this.nodesAt(items);
    } finally {
      this.depth--;
    }
  }

  nodesAt(items: Item[]): Inline[] {
    const out: Inline[] = [];
    for (const it of items) {
      if (it.k !== "text" && this.depth > MAX_TREE_DEPTH) {
        // Too deep to build: the construct is kept as its literal source text.
        this.text(it.s, it.e, out);
        continue;
      }
      switch (it.k) {
        case "text":
          this.text(it.s, it.e, out);
          break;
        case "code":
          out.push({ type: "code", value: it.value, range: this.range(it.s, it.e) });
          break;
        case "autolink":
          out.push({
            type: "link",
            kind: "autolink",
            destination: it.email ? "mailto:" + it.url : it.url,
            title: null,
            children: [{ type: "text", value: it.url, range: this.range(it.s + 1, it.e - 1) }],
            range: this.range(it.s, it.e),
          });
          break;
        case "bare":
          out.push({
            type: "link",
            kind: "bare",
            destination: it.href,
            title: null,
            children: [{ type: "text", value: it.text, range: this.range(it.s, it.e) }],
            range: this.range(it.s, it.e),
          });
          break;
        case "span": {
          const attributes: AttributeList = {
            type: "attributeList",
            attributes: it.attrs.attributes.map((a) => ({
              key: a.key,
              value: a.value,
              quoted: a.quoted,
              range: this.range(a.start, a.end),
            })),
            range: this.range(it.attrs.start, it.attrs.end),
          };
          out.push({ type: "span", attributes, children: this.nodes(it.scope.items), range: this.range(it.s, it.e) });
          break;
        }
        case "link":
          out.push({
            type: "link",
            kind: it.kind,
            destination: it.destination,
            title: it.title,
            children: this.nodes(it.scope.items),
            range: this.range(it.s, it.e),
          });
          break;
        case "image": {
          const children = this.nodes(it.scope.items);
          out.push({
            type: "image",
            kind: it.kind,
            destination: it.destination,
            title: it.title,
            children,
            alt: plainText(children, "\n"),
            destinationRange: it.definition
              ? { ...it.definition.destinationRange }
              : this.range(it.destStart ?? it.s, it.destEnd ?? it.s),
            ...(it.definition ? { label: it.definition.label } : {}),
            range: this.range(it.s, it.e),
          });
          break;
        }
        case "mark":
          out.push({
            type: it.ch === "+" ? "underline" : "highlight",
            children: this.nodes(it.scope.items),
            range: this.range(it.s, it.e),
          });
          break;
        case "emph":
        case "strong":
        case "del":
          out.push({
            type: it.k === "emph" ? "emphasis" : it.k === "strong" ? "strong" : "strikethrough",
            children: this.nodes(it.items),
            range: this.range(it.s, it.e),
          });
          break;
      }
    }
    return mergeTextNodes(out);
  }

  /**
   * Literal text: resolves backslash escapes and entity references, and turns line endings into
   * soft or hard line breaks (CommonMark 6.7 and 6.8).
   */
  text(s: number, e: number, out: Inline[]): void {
    const t = this.input.text;
    let buf = "";
    let bufStart = -1;
    const begin = (j: number) => {
      if (bufStart < 0) bufStart = j;
    };
    const flush = (end: number) => {
      if (buf !== "") out.push({ type: "text", value: buf, range: this.range(bufStart, end) });
      buf = "";
      bufStart = -1;
    };
    let j = s;
    while (j < e) {
      const c = t[j];
      if (c === "\n") {
        let spaces = 0;
        while (j - spaces - 1 >= s && t[j - spaces - 1] === " ") spaces++;
        buf = buf.slice(0, buf.length - spaces);
        flush(j - spaces);
        out.push({ type: spaces >= 2 ? "hardBreak" : "softBreak", range: this.range(j - spaces, j + 1) });
        j++;
        continue;
      }
      if (c === "\\" && j + 1 < e) {
        if (t[j + 1] === "\n") {
          flush(j);
          out.push({ type: "hardBreak", range: this.range(j, j + 2) });
          j += 2;
          continue;
        }
        if (isAsciiPunct(t[j + 1])) {
          begin(j);
          buf += t[j + 1];
          j += 2;
          continue;
        }
      }
      if (c === "&") {
        const m = matchEntity(t, j);
        if (m && j + m.length <= e) {
          begin(j);
          buf += m.text;
          j += m.length;
          continue;
        }
      }
      begin(j);
      buf += c;
      j++;
    }
    flush(e);
  }
}

function mergeTextNodes(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (n.type === "text" && last && last.type === "text" && last.range.end === n.range.start) {
      out[out.length - 1] = { type: "text", value: last.value + n.value, range: { start: last.range.start, end: n.range.end } };
    } else {
      out.push(n);
    }
  }
  return out;
}

/** The plain text of inline nodes: text without markup, line breaks as `lineBreak`. */
export function plainText(nodes: readonly Inline[], lineBreak = " "): string {
  let s = "";
  for (const n of nodes) {
    switch (n.type) {
      case "text":
      case "code":
        s += n.value;
        break;
      case "softBreak":
      case "hardBreak":
        s += lineBreak;
        break;
      case "image":
        s += n.alt;
        break;
      default:
        s += plainText(n.children, lineBreak);
    }
  }
  return s;
}
