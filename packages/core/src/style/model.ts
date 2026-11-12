// The parsed note as the style commands see it (EDITOR-PLAN 5): the visible characters of
// styleRuns(), and for each block its inline tree, each node knowing which visible characters
// it holds and where its delimiters are in the source.

import { parseNote, styleRuns, type Block, type BlockInfo, type Inline, type Note, type StyleRunsResult, type VisibleChar } from "../../../../noteformat/src/index.ts";

export type NodeKind =
  | "text"
  | "soft"
  | "hard"
  | "code"
  | "emphasis"
  | "strong"
  | "strike"
  | "underline"
  | "highlight"
  | "span"
  | "link"
  | "image";

export interface INode {
  kind: NodeKind;
  /** The parser's node. */
  node: Inline;
  start: number;
  end: number;
  /** For containers: where the content starts and ends in the source. */
  contentStart: number;
  contentEnd: number;
  /** Visible characters [va, vb) (indices into the note's chars). */
  va: number;
  vb: number;
  children: INode[];
  parent: INode | null;
  /** For a span: the attribute list's source range and its attributes. */
  attrs?: { start: number; end: number; list: { key: string; value: string; start: number; end: number }[] };
  /** For a link: inline, reference, autolink or bare; its destination. */
  linkKind?: "inline" | "reference" | "autolink" | "bare";
  destination?: string;
}

export interface BlockModel {
  index: number;
  info: BlockInfo;
  /** The parser's block (paragraph, heading, code block, table cell). */
  block: Block | null;
  /** The inline tree (the block's own scope). */
  root: INode[];
  /** Visible characters [va, vb). */
  va: number;
  vb: number;
}

export interface Model {
  text: string;
  note: Note;
  runs: StyleRunsResult;
  chars: VisibleChar[];
  blocks: BlockModel[];
}

const KIND: Record<string, NodeKind> = {
  text: "text",
  softBreak: "soft",
  hardBreak: "hard",
  code: "code",
  emphasis: "emphasis",
  strong: "strong",
  strikethrough: "strike",
  underline: "underline",
  highlight: "highlight",
  span: "span",
  link: "link",
  image: "image",
};

// The last few models, by text: a command parses the same texts many times.
const cache = new Map<string, Model>();
const CACHE_SIZE = 48;

export function buildModel(text: string): Model {
  const hit = cache.get(text);
  if (hit) {
    cache.delete(text);
    cache.set(text, hit);
    return hit;
  }
  const m = makeModel(text);
  cache.set(text, m);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return m;
}

function makeModel(text: string): Model {
  const note = parseNote(text);
  const runs = styleRuns(note, text);
  const chars = runs.chars;
  const blocks: BlockModel[] = [];
  // The blocks of styleRuns in document order, with the parser's block for each.
  const parserBlocks: (Block | { type: "cell"; children: Inline[]; range: { start: number; end: number } } | null)[] = [];
  const walk = (bs: readonly Block[]) => {
    for (const b of bs) {
      if (b.type === "paragraph" || b.type === "heading") parserBlocks.push(b);
      else if (b.type === "blockQuote") walk(b.children);
      else if (b.type === "list") for (const item of b.children) walk(item.children);
      else if (b.type === "codeBlock" || b.type === "thematicBreak") parserBlocks.push(b);
      else if (b.type === "table") for (const row of [b.head, ...b.body]) for (const c of row.cells) parserBlocks.push({ type: "cell", children: c.children, range: c.range });
    }
  };
  walk(note.children);
  // The visible range of each block.
  const starts: number[] = new Array(runs.blocks.length).fill(-1);
  const ends: number[] = new Array(runs.blocks.length).fill(-1);
  chars.forEach((c, i) => {
    if (starts[c.block] < 0) starts[c.block] = i;
    ends[c.block] = i + 1;
  });
  let prevEnd = 0;
  runs.blocks.forEach((info, i) => {
    const va = starts[i] < 0 ? prevEnd : starts[i];
    const vb = starts[i] < 0 ? prevEnd : ends[i];
    prevEnd = vb;
    const pb = parserBlocks[i] ?? null;
    const inl = pb && "children" in pb && pb.type !== "blockQuote" && pb.type !== "list" ? (pb.children as Inline[]) : [];
    const root = info.kind === "code" || info.kind === "rule" ? [] : buildNodes(inl, null, chars, va, vb, text);
    blocks.push({ index: i, info, block: pb && pb.type !== "cell" ? (pb as Block) : null, root, va, vb });
  });
  return { text, note, runs, chars, blocks };
}

/** The visible characters a source range holds: [va, vb) among chars[lo, hi). */
function visibleRange(chars: VisibleChar[], lo: number, hi: number, start: number, end: number): [number, number] {
  let va = -1;
  let vb = -1;
  for (let i = lo; i < hi; i++) {
    const c = chars[i];
    if (c.start >= start && c.end <= end) {
      if (va < 0) va = i;
      vb = i + 1;
    } else if (va >= 0) break;
  }
  if (va < 0) {
    // No visible character: an empty range at the first character after `start`.
    let k = lo;
    while (k < hi && chars[k].start < start) k++;
    return [k, k];
  }
  return [va, vb];
}

function buildNodes(nodes: readonly Inline[], parent: INode | null, chars: VisibleChar[], lo: number, hi: number, text: string): INode[] {
  const out: INode[] = [];
  for (const n of nodes) {
    const kind = KIND[n.type];
    const [va, vb] = visibleRange(chars, lo, hi, n.range.start, n.range.end);
    const inode: INode = {
      kind,
      node: n,
      start: n.range.start,
      end: n.range.end,
      contentStart: n.range.start,
      contentEnd: n.range.end,
      va,
      vb,
      children: [],
      parent,
    };
    if ("children" in n && n.type !== "image") {
      const kids = (n as { children: Inline[] }).children;
      inode.children = buildNodes(kids, inode, chars, va, vb, text);
      if (kids.length) {
        inode.contentStart = kids[0].range.start;
        inode.contentEnd = kids[kids.length - 1].range.end;
      }
    }
    if (n.type === "span") {
      inode.attrs = {
        start: n.attributes.range.start,
        end: n.attributes.range.end,
        list: n.attributes.attributes.map((a) => ({ key: a.key, value: a.value, start: a.range.start, end: a.range.end })),
      };
      inode.contentEnd = n.attributes.range.start - 1;
    }
    if (n.type === "link") {
      inode.linkKind = n.kind;
      inode.destination = n.destination;
      if (n.kind === "autolink") {
        inode.contentStart = n.range.start + 1;
        inode.contentEnd = n.range.end - 1;
      } else if (n.kind === "bare") {
        inode.contentStart = n.range.start;
        inode.contentEnd = n.range.end;
      }
    }
    void text;
    out.push(inode);
  }
  return out;
}

/** The block holding visible character `i`. */
export function blockOf(m: Model, i: number): BlockModel {
  return m.blocks[m.chars[i].block];
}

/** Every node of a tree, depth first. */
export function* allNodes(nodes: INode[]): Generator<INode> {
  for (const n of nodes) {
    yield n;
    yield* allNodes(n.children);
  }
}

/** The nearest span ancestor of visible character i within a block's tree, or null. */
export function spanOf(nodes: INode[], i: number): INode | null {
  for (const n of nodes) {
    if (i >= n.va && i < n.vb) {
      if (n.kind === "span") return n;
      return spanOf(n.children, i);
    }
  }
  return null;
}

/** The chain of nodes containing visible character i, outermost first. */
export function pathTo(nodes: INode[], i: number): INode[] {
  for (const n of nodes) {
    if (i >= n.va && i < n.vb) return [n, ...pathTo(n.children, i)];
  }
  return [];
}

export function isContainer(n: INode): boolean {
  return n.kind === "emphasis" || n.kind === "strong" || n.kind === "strike" || n.kind === "underline" || n.kind === "highlight" || n.kind === "span" || n.kind === "link";
}

export type { VisibleChar, BlockInfo };
