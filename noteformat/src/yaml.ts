// A YAML 1.2 reader for front matter (SPEC 3, condition 3).
//
// Only what front matter needs is produced: mappings, sequences and scalars, where a scalar is
// kept as its text and never converted (SPEC 3: "A number or boolean is not converted"), so the
// choice of the Core schema only matters for which documents are valid. Duplicate keys are
// allowed, as SPEC 3 requires.
//
// Supported: block mappings and sequences (including compact `- key: value` items and a
// sequence at the same indentation as its key), flow mappings and sequences over several lines,
// plain, single-quoted and double-quoted scalars over several lines, literal and folded block
// scalars with chomping and indentation indicators, comments, anchors, aliases and tags (tags
// are read and ignored). Anything else, such as explicit `?` keys, collections or aliases used
// as keys, directives and document markers, is reported as an error, which makes the file have
// no front matter. README.md lists this under "Known gaps".

import type { YamlNode, YamlScalar } from "./types.ts";

export class YamlError extends Error {}

function fail(message: string, line: number): never {
  throw new YamlError(`${message} (line ${line + 1})`);
}

const empty = (): YamlScalar => ({ kind: "scalar", value: "", style: "plain" });

function isWs(c: string | undefined): boolean {
  return c === " " || c === "\t";
}

/** Strips a comment (` #…` or a leading `#`) from plain block text that starts at `from`. */
function cutComment(text: string, from: number): string {
  for (let k = from; k < text.length; k++) {
    if (text[k] === "#" && (k === from || isWs(text[k - 1]))) return text.slice(from, k);
  }
  return text.slice(from);
}

/** In block context: the position of a `:` that is a mapping indicator, or -1. */
function findMapColon(text: string, from: number): number {
  for (let k = from; k < text.length; k++) {
    const c = text[k];
    if (c === "#" && k > from && isWs(text[k - 1])) return -1;
    if (c === ":" && (k + 1 === text.length || isWs(text[k + 1]))) return k;
  }
  return -1;
}

const FLOW_INDICATORS = ",[]{}";

/** Collections nest at most this deep; deeper front matter is reported as an error. */
export const MAX_YAML_DEPTH = 64;

class Parser {
  lines: string[];
  /** The next line that has not been consumed. */
  pos = 0;
  anchors = new Map<string, YamlNode>();
  /** Current nesting of nodes, for MAX_YAML_DEPTH. */
  depth = 0;

  enter(line: number): void {
    if (++this.depth > MAX_YAML_DEPTH) fail("nesting too deep", line);
  }

  constructor(text: string) {
    this.lines = text.split("\n");
  }

  isBlankOrComment(i: number): boolean {
    const t = this.lines[i].replace(/^[ \t]+/, "");
    return t === "" || t[0] === "#";
  }

  nextContent(from: number): number {
    let i = from;
    while (i < this.lines.length && this.isBlankOrComment(i)) i++;
    return i;
  }

  indentOf(i: number): number {
    const t = this.lines[i];
    let k = 0;
    while (t[k] === " ") k++;
    if (t[k] === "\t") fail("tab used for indentation", i);
    return k;
  }

  isSeqLine(i: number, indent: number): boolean {
    const t = this.lines[i];
    return t[indent] === "-" && (indent + 1 === t.length || isWs(t[indent + 1]));
  }

  checkLineRest(i: number, k: number): void {
    const t = this.lines[i];
    while (isWs(t[k])) k++;
    if (k < t.length && t[k] !== "#") fail("unexpected text after a value", i);
  }

  document(): YamlNode | null {
    for (let i = 0; i < this.lines.length; i++) {
      const t = this.lines[i];
      if (/^(?:%|(?:---|\.\.\.)(?:[ \t]|$))/.test(t)) fail("directives and document markers are not supported", i);
    }
    const i = this.nextContent(0);
    if (i >= this.lines.length) return null;
    const node = this.nodeAt(-1, i, this.indentOf(i), true);
    const j = this.nextContent(this.pos);
    if (j < this.lines.length) fail("unexpected content", j);
    return node;
  }

  /** Reads `&anchor` and `!tag` properties at (i, k); returns the position after them. */
  properties(i: number, k: number): { k: number; anchor: string | null } {
    const t = this.lines[i];
    let anchor: string | null = null;
    for (;;) {
      while (isWs(t[k])) k++;
      if (t[k] === "&" || t[k] === "!") {
        const isAnchor = t[k] === "&";
        let e = k + 1;
        while (e < t.length && !isWs(t[e]) && !(isAnchor && FLOW_INDICATORS.includes(t[e]))) e++;
        if (isAnchor) {
          if (e === k + 1) fail("empty anchor", i);
          anchor = t.slice(k + 1, e);
        }
        k = e;
        continue;
      }
      return { k, anchor };
    }
  }

  /**
   * The value after `key:` or `- ` on line i, column k. `indent` is the indentation of the
   * collection that holds it. A value may sit on the same line or on the following lines.
   */
  valueAfter(indent: number, i: number, k: number, inMapping: boolean, compact: boolean): YamlNode {
    const props = this.properties(i, k);
    k = props.k;
    const t = this.lines[i];
    let node: YamlNode;
    if (k >= t.length || t[k] === "#") {
      const j = this.nextContent(i + 1);
      if (j < this.lines.length && this.indentOf(j) > indent) {
        node = this.nodeAt(indent, j, this.indentOf(j), true);
      } else if (inMapping && j < this.lines.length && this.indentOf(j) === indent && this.isSeqLine(j, indent)) {
        node = this.sequence(j, indent);
      } else {
        node = empty();
        this.pos = i + 1;
      }
    } else {
      node = this.nodeAt(indent, i, k, compact);
    }
    if (props.anchor !== null) this.anchors.set(props.anchor, node);
    return node;
  }

  /**
   * A node that starts at line i, column k. `parent` is the indentation of the enclosing
   * collection. `compact` allows a block collection to start here.
   */
  nodeAt(parent: number, i: number, k: number, compact: boolean): YamlNode {
    this.enter(i);
    try {
      return this.nodeAtInner(parent, i, k, compact);
    } finally {
      this.leave();
    }
  }

  leave(): void {
    this.depth--;
  }

  nodeAtInner(parent: number, i: number, k: number, compact: boolean): YamlNode {
    const props = this.properties(i, k);
    if (props.k !== k) {
      const node = this.valueAfter(parent, i, k, false, compact);
      return node;
    }
    const t = this.lines[i];
    const c = t[k];
    const next = t[k + 1];
    if (c === "-" && (next === undefined || isWs(next))) {
      if (!compact) fail("a block sequence cannot start here", i);
      return this.sequence(i, k);
    }
    if ((c === "?" || c === ":") && (next === undefined || isWs(next))) fail("explicit keys are not supported", i);
    if (c === "[" || c === "{") {
      const f = new FlowReader(this, i, k);
      const node = f.node();
      f.skipSpace();
      if (this.lines[f.i][f.k] === ":") fail("collections as keys are not supported", f.i);
      this.checkLineRest(f.i, f.k);
      this.pos = f.i + 1;
      return node;
    }
    if (c === "|" || c === ">") return this.blockScalar(parent, i, k);
    if (c === "*") {
      let e = k + 1;
      while (e < t.length && !isWs(t[e])) e++;
      const name = t.slice(k + 1, e);
      const node = this.anchors.get(name);
      if (!node) fail(`unknown alias *${name}`, i);
      let r = e;
      while (isWs(t[r])) r++;
      if (t[r] === ":") fail("aliases as keys are not supported", i);
      this.checkLineRest(i, e);
      this.pos = i + 1;
      return node;
    }
    if (c === '"' || c === "'") {
      const q = c === '"' ? readDouble(this.lines, i, k) : readSingle(this.lines, i, k);
      let r = q.k;
      const qt = this.lines[q.i];
      while (isWs(qt[r])) r++;
      if (qt[r] === ":" && (r + 1 === qt.length || isWs(qt[r + 1]))) {
        if (!compact) fail("a mapping cannot start here", i);
        if (q.i !== i) fail("a key must be on one line", i);
        return this.mapping(i, k);
      }
      this.checkLineRest(q.i, q.k);
      this.pos = q.i + 1;
      return { kind: "scalar", value: q.value, style: c === '"' ? "double" : "single" };
    }
    if (findMapColon(t, k) >= 0) {
      if (!compact) fail("a mapping cannot start here", i);
      return this.mapping(i, k);
    }
    return this.plain(parent, i, k);
  }

  mapping(i: number, indent: number): YamlNode {
    const entries: { key: string; value: YamlNode }[] = [];
    for (;;) {
      const t = this.lines[i];
      let k = indent;
      let key: string;
      const c = t[k];
      if (c === '"' || c === "'") {
        const q = c === '"' ? readDouble(this.lines, i, k) : readSingle(this.lines, i, k);
        if (q.i !== i) fail("a key must be on one line", i);
        key = q.value;
        k = q.k;
        while (isWs(t[k])) k++;
        if (t[k] !== ":" || !(k + 1 === t.length || isWs(t[k + 1]))) fail("expected ':' after a key", i);
      } else {
        if ("[{*&!?|>%@`,]}#".includes(c)) fail("this kind of key is not supported", i);
        if (c === "-" && (t[k + 1] === undefined || isWs(t[k + 1]))) fail("a sequence entry inside a mapping", i);
        const colon = findMapColon(t, k);
        if (colon < 0) fail("expected a key", i);
        key = t.slice(k, colon).replace(/[ \t]+$/, "");
        if (key === "") fail("empty key", i);
        k = colon;
      }
      const value = this.valueAfter(indent, i, k + 1, true, false);
      entries.push({ key, value });
      const j = this.nextContent(this.pos);
      if (j >= this.lines.length) break;
      const ind = this.indentOf(j);
      if (ind < indent) break;
      if (ind > indent) fail("bad indentation of a mapping entry", j);
      i = j;
    }
    return { kind: "map", entries };
  }

  sequence(i: number, indent: number): YamlNode {
    const items: YamlNode[] = [];
    for (;;) {
      items.push(this.valueAfter(indent, i, indent + 1, false, true));
      const j = this.nextContent(this.pos);
      if (j >= this.lines.length) break;
      const ind = this.indentOf(j);
      if (ind < indent) break;
      if (ind > indent) fail("bad indentation of a sequence entry", j);
      if (!this.isSeqLine(j, indent)) break;
      i = j;
    }
    return { kind: "seq", items };
  }

  plain(parent: number, i: number, k: number): YamlNode {
    const t = this.lines[i];
    const c = t[k];
    if (",[]{}#&*!|>'\"%@`".includes(c)) fail("a plain scalar cannot start with this character", i);
    let value = cutComment(t, k).replace(/[ \t]+$/, "");
    let commentSeen = value.length < t.length - k && /#/.test(t.slice(k + value.length));
    let j = i + 1;
    let last = i;
    let blanks = 0;
    while (!commentSeen && j < this.lines.length) {
      const lt = this.lines[j];
      if (/^[ \t]*$/.test(lt)) {
        blanks++;
        j++;
        continue;
      }
      if (/^[ \t]*#/.test(lt)) break;
      const ind = this.indentOf(j);
      if (ind <= parent) break;
      const cut = cutComment(lt, ind);
      commentSeen = cut.length < lt.length - ind;
      const part = cut.replace(/^[ \t]+|[ \t]+$/g, "");
      if (findMapColon(part, 0) >= 0) fail("a mapping value is not allowed here", j);
      value += (blanks > 0 ? "\n".repeat(blanks) : " ") + part;
      blanks = 0;
      last = j;
      j++;
    }
    this.pos = last + 1;
    return { kind: "scalar", value, style: "plain" };
  }

  blockScalar(parent: number, i: number, k: number): YamlNode {
    const t = this.lines[i];
    const style = t[k] === "|" ? "literal" : "folded";
    let chomp: "clip" | "strip" | "keep" = "clip";
    let explicit = 0;
    let p = k + 1;
    for (let n = 0; n < 2; n++) {
      if (t[p] === "-" || t[p] === "+") {
        chomp = t[p] === "-" ? "strip" : "keep";
        p++;
      } else if (t[p] !== undefined && t[p] >= "1" && t[p] <= "9") {
        explicit = Number(t[p]);
        p++;
      }
    }
    if (p < t.length && !isWs(t[p])) fail("bad block scalar header", i);
    this.checkLineRest(i, p);
    const base = Math.max(parent, 0);
    let contentIndent = explicit > 0 ? base + explicit : -1;
    const content: string[] = [];
    let j = i + 1;
    for (; j < this.lines.length; j++) {
      const lt = this.lines[j];
      if (/^ *$/.test(lt)) {
        content.push(contentIndent >= 0 && lt.length > contentIndent ? lt.slice(contentIndent) : "");
        continue;
      }
      let ind = 0;
      while (lt[ind] === " ") ind++;
      if (contentIndent < 0) {
        if (ind <= parent) break;
        contentIndent = ind;
      }
      if (ind < contentIndent) break;
      content.push(lt.slice(contentIndent));
    }
    // Trailing empty lines are governed by chomping.
    let trailing = 0;
    while (content.length > 0 && content[content.length - 1] === "") {
      content.pop();
      trailing++;
    }
    let body: string;
    if (style === "literal") {
      body = content.join("\n");
    } else {
      body = "";
      let prev: "normal" | "more" | null = null;
      let pendingEmpty = 0;
      for (const line of content) {
        if (line === "") {
          pendingEmpty++;
          continue;
        }
        const type = isWs(line[0]) ? "more" : "normal";
        if (prev === null) body = "\n".repeat(pendingEmpty) + line;
        else if (prev === "normal" && type === "normal") body += (pendingEmpty > 0 ? "\n".repeat(pendingEmpty) : " ") + line;
        else body += "\n" + "\n".repeat(pendingEmpty) + line;
        pendingEmpty = 0;
        prev = type;
      }
    }
    if (content.length > 0) {
      if (chomp === "clip") body += "\n";
      else if (chomp === "keep") body += "\n" + "\n".repeat(trailing);
    } else if (chomp === "keep") {
      body = "\n".repeat(trailing);
    }
    this.pos = j;
    return { kind: "scalar", value: body, style };
  }
}

interface QuotedResult {
  value: string;
  /** Line and column just after the closing quote. */
  i: number;
  k: number;
}

/** Line folding inside a quoted scalar: returns the joiner and the position on the next line. */
function foldQuoted(lines: string[], i: number): { joiner: string; i: number; k: number } {
  let blanks = 0;
  let j = i + 1;
  while (j < lines.length && /^[ \t]*$/.test(lines[j])) {
    blanks++;
    j++;
  }
  if (j >= lines.length) fail("unterminated quoted scalar", i);
  let k = 0;
  while (isWs(lines[j][k])) k++;
  return { joiner: blanks > 0 ? "\n".repeat(blanks) : " ", i: j, k };
}

const DOUBLE_ESCAPES: Record<string, string> = {
  "0": "\0",
  a: "\x07",
  b: "\b",
  t: "\t",
  "\t": "\t",
  n: "\n",
  v: "\v",
  f: "\f",
  r: "\r",
  e: "\x1b",
  " ": " ",
  '"': '"',
  "/": "/",
  "\\": "\\",
  N: "\u0085",
  _: " ",
  L: " ",
  P: " ",
};

function readDouble(lines: string[], i: number, k: number): QuotedResult {
  let value = "";
  let kept = 0; // length of value that trailing-space trimming must not touch
  k++;
  for (;;) {
    const t = lines[i];
    if (k >= t.length) {
      value = value.slice(0, kept) + value.slice(kept).replace(/[ \t]+$/, "");
      const f = foldQuoted(lines, i);
      value += f.joiner;
      kept = value.length;
      i = f.i;
      k = f.k;
      continue;
    }
    const c = t[k];
    if (c === '"') return { value, i, k: k + 1 };
    if (c === "\\") {
      if (k + 1 >= t.length) {
        // An escaped line break: no space is inserted.
        if (i + 1 >= lines.length) fail("unterminated quoted scalar", i);
        i++;
        k = 0;
        while (isWs(lines[i][k])) k++;
        kept = value.length;
        continue;
      }
      const e = t[k + 1];
      const hex = e === "x" ? 2 : e === "u" ? 4 : e === "U" ? 8 : 0;
      if (hex > 0) {
        const digits = t.slice(k + 2, k + 2 + hex);
        if (!new RegExp(`^[0-9a-fA-F]{${hex}}$`).test(digits)) fail("bad escape", i);
        const cp = parseInt(digits, 16);
        if (cp > 0x10ffff) fail("bad escape", i);
        value += String.fromCodePoint(cp);
        k += 2 + hex;
      } else if (Object.hasOwn(DOUBLE_ESCAPES, e)) {
        value += DOUBLE_ESCAPES[e];
        k += 2;
      } else {
        fail("bad escape", i);
      }
      kept = value.length;
      continue;
    }
    value += c;
    k++;
  }
}

function readSingle(lines: string[], i: number, k: number): QuotedResult {
  let value = "";
  let kept = 0;
  k++;
  for (;;) {
    const t = lines[i];
    if (k >= t.length) {
      value = value.slice(0, kept) + value.slice(kept).replace(/[ \t]+$/, "");
      const f = foldQuoted(lines, i);
      value += f.joiner;
      kept = value.length;
      i = f.i;
      k = f.k;
      continue;
    }
    if (t[k] === "'") {
      if (t[k + 1] === "'") {
        value += "'";
        k += 2;
        kept = value.length;
        continue;
      }
      return { value, i, k: k + 1 };
    }
    value += t[k];
    k++;
  }
}

/** Reads flow collections and flow scalars, across lines. */
class FlowReader {
  p: Parser;
  i: number;
  k: number;

  constructor(p: Parser, i: number, k: number) {
    this.p = p;
    this.i = i;
    this.k = k;
  }

  get line(): string {
    return this.p.lines[this.i];
  }

  /** Skips spaces, tabs, comments and line breaks. */
  skipAll(): void {
    for (;;) {
      const t = this.line;
      if (this.k >= t.length) {
        if (this.i + 1 >= this.p.lines.length) fail("unterminated flow collection", this.i);
        this.i++;
        this.k = 0;
        continue;
      }
      const c = t[this.k];
      if (isWs(c)) this.k++;
      else if (c === "#" && (this.k === 0 || isWs(t[this.k - 1]))) this.k = t.length;
      else return;
    }
  }

  /** Skips spaces and tabs on the current line only. */
  skipSpace(): void {
    const t = this.line;
    while (isWs(t[this.k])) this.k++;
  }

  node(): YamlNode {
    this.p.enter(this.i);
    try {
      return this.nodeInner();
    } finally {
      this.p.leave();
    }
  }

  nodeInner(): YamlNode {
    this.skipAll();
    let anchor: string | null = null;
    for (;;) {
      const c = this.line[this.k];
      if (c !== "&" && c !== "!") break;
      const t = this.line;
      let e = this.k + 1;
      while (e < t.length && !isWs(t[e]) && !FLOW_INDICATORS.includes(t[e])) e++;
      if (c === "&") anchor = t.slice(this.k + 1, e);
      this.k = e;
      this.skipAll();
    }
    const node = this.bareNode();
    if (anchor !== null) this.p.anchors.set(anchor, node);
    return node;
  }

  isValueColon(): boolean {
    const t = this.line;
    if (t[this.k] !== ":") return false;
    const n = t[this.k + 1];
    return n === undefined || isWs(n) || FLOW_INDICATORS.includes(n);
  }

  bareNode(): YamlNode {
    const t = this.line;
    const c = t[this.k];
    if (c === "[") {
      this.k++;
      const items: YamlNode[] = [];
      for (;;) {
        this.skipAll();
        if (this.line[this.k] === "]") {
          this.k++;
          return { kind: "seq", items };
        }
        const item = this.node();
        this.skipAll();
        if (this.isValueColon()) {
          // A single pair inside a flow sequence: [a: b]
          this.k++;
          this.skipAll();
          const n = this.line[this.k];
          const value = n === "," || n === "]" ? empty() : this.node();
          items.push({ kind: "map", entries: [{ key: scalarKey(item, this.i), value }] });
          this.skipAll();
        } else {
          items.push(item);
        }
        const sep = this.line[this.k];
        if (sep === ",") this.k++;
        else if (sep !== "]") fail("expected ',' or ']'", this.i);
      }
    }
    if (c === "{") {
      this.k++;
      const entries: { key: string; value: YamlNode }[] = [];
      for (;;) {
        this.skipAll();
        if (this.line[this.k] === "}") {
          this.k++;
          return { kind: "map", entries };
        }
        if (this.line[this.k] === "?") fail("explicit keys are not supported", this.i);
        const keyNode = this.node();
        this.skipAll();
        let value: YamlNode = empty();
        if (this.isValueColon()) {
          this.k++;
          this.skipAll();
          const n = this.line[this.k];
          if (n !== "," && n !== "}") value = this.node();
          this.skipAll();
        }
        entries.push({ key: scalarKey(keyNode, this.i), value });
        const sep = this.line[this.k];
        if (sep === ",") this.k++;
        else if (sep !== "}") fail("expected ',' or '}'", this.i);
      }
    }
    if (c === '"' || c === "'") {
      const q = c === '"' ? readDouble(this.p.lines, this.i, this.k) : readSingle(this.p.lines, this.i, this.k);
      this.i = q.i;
      this.k = q.k;
      return { kind: "scalar", value: q.value, style: c === '"' ? "double" : "single" };
    }
    if (c === "*") {
      let e = this.k + 1;
      while (e < t.length && !isWs(t[e]) && !FLOW_INDICATORS.includes(t[e])) e++;
      const name = t.slice(this.k + 1, e);
      const node = this.p.anchors.get(name);
      if (!node) fail(`unknown alias *${name}`, this.i);
      this.k = e;
      return node;
    }
    if (c === undefined || ",]}#|>%@`".includes(c)) fail("expected a value", this.i);
    if ((c === "-" || c === "?" || c === ":") && (t[this.k + 1] === undefined || isWs(t[this.k + 1]))) {
      fail("unsupported indicator in a flow collection", this.i);
    }
    return this.plainFlow();
  }

  plainFlow(): YamlNode {
    let value = "";
    let blanks = -1; // -1: no line break pending
    for (;;) {
      const t = this.line;
      let e = this.k;
      while (e < t.length) {
        const c = t[e];
        if (FLOW_INDICATORS.includes(c)) break;
        if (c === ":" && (e + 1 === t.length || isWs(t[e + 1]) || FLOW_INDICATORS.includes(t[e + 1]))) break;
        if (c === "#" && e > 0 && isWs(t[e - 1])) break;
        e++;
      }
      const part = t.slice(this.k, e).replace(/[ \t]+$/, "");
      if (part !== "") {
        if (blanks >= 0) value += blanks > 0 ? "\n".repeat(blanks) : " ";
        value += part;
        blanks = -1;
      }
      if (e < t.length) {
        this.k = this.k + part.length;
        // leave trailing spaces for the caller to skip
        return { kind: "scalar", value, style: "plain" };
      }
      // The scalar may continue on the next line.
      let j = this.i + 1;
      let b = 0;
      while (j < this.p.lines.length && /^[ \t]*$/.test(this.p.lines[j])) {
        b++;
        j++;
      }
      if (j >= this.p.lines.length) fail("unterminated flow collection", this.i);
      const nt = this.p.lines[j];
      let nk = 0;
      while (isWs(nt[nk])) nk++;
      const nc = nt[nk];
      if (FLOW_INDICATORS.includes(nc) || nc === "#" || (nc === ":" && (nk + 1 === nt.length || isWs(nt[nk + 1])))) {
        this.k = t.length;
        return { kind: "scalar", value, style: "plain" };
      }
      blanks = b;
      this.i = j;
      this.k = nk;
    }
  }
}

function scalarKey(node: YamlNode, line: number): string {
  if (node.kind !== "scalar") fail("collections as keys are not supported", line);
  return node.value;
}

/**
 * Parses YAML text. Returns null for an empty document (only blank lines and comments).
 * Throws YamlError for text that is not valid YAML or uses a feature this reader lacks.
 */
export function parseYaml(text: string): YamlNode | null {
  return new Parser(text).document();
}
