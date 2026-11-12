// SPEC 5 step 2: the body is divided into blocks by the CommonMark and GFM block rules, with
// HTML blocks off. markdown-it does the block parsing; this file hooks its block rules to keep
// the source position of every line of every block, and turns its token stream into the
// syntax tree of types.ts. Task list markers are recognised here, as step 2 requires.
//
// Inline text is not parsed here. Each paragraph, heading and table cell is returned with the
// lines of its inline text, so that step 3 (blockattrs.ts) can look at the lines and step 4
// (inline/) can parse them.

import MarkdownIt, { type MarkdownIt as MarkdownItInstance, type StateBlock, type Token } from "markdown-it";
import { unescapeString } from "./entities.ts";
import { isBlankText, sourceRange, type BodyText } from "./source.ts";
import type { Alignment, Block, Heading, LinkDefinition, ListItem, Paragraph, TableCell, TableRow } from "./types.ts";
import type { InlineInput } from "./inline/index.ts";

/** A line of inline text: [start, end) in body text positions. */
export type ContentLine = [number, number];

/** A block whose inline text still has to be parsed. */
export type InlineJob =
  | { node: Paragraph | Heading; lines: ContentLine[] }
  | { node: TableCell; input: InlineInput };

export interface BlockResult {
  children: Block[];
  definitions: LinkDefinition[];
  jobs: InlineJob[];
  /** For each top-level paragraph and heading: the body line numbers it covers. */
  lineSpans: Map<Block, [number, number]>;
}

type RuleFn = (state: StateBlock, startLine: number, endLine: number, silent: boolean) => boolean;
interface RuleEntry {
  name: string;
  fn: RuleFn;
}

interface TokenMeta {
  /** Source position (body text) of the first non-whitespace character of the first line. */
  start?: number;
  /** For each line of the block: first non-whitespace position and end of line. */
  lines?: ContentLine[];
  label?: string;
  definition?: { href: string; title: string };
  /** A reference definition's destination as written: [start, end) in body text positions. */
  destination?: [number, number];
}

function createParser(): MarkdownItInstance {
  // CommonMark preset with HTML off: no HTML blocks (SPEC 4).
  const md = new MarkdownIt("commonmark", { html: false });
  md.enable("table");
  // GFM tables, split the same way for structure and for cells.
  md.block.ruler.at("table", gfmTable, { alt: ["paragraph", "reference"] });
  // Keep destinations as CommonMark gives them; the renderer encodes and checks them.
  md.normalizeLink = (url: string) => url;
  md.validateLink = () => true;

  // The reference rule finds the destination with this helper; record where it was found, so
  // that a definition's destination has a source range (SPEC 1.1 / DESIGN 5.6).
  let lastDestination: [number, number] | null = null;
  const helpers = md.helpers as unknown as {
    parseLinkDestination: (src: string, pos: number, max: number) => { ok: boolean; pos: number };
  };
  const parseDestination = helpers.parseLinkDestination;
  helpers.parseLinkDestination = (src, pos, max) => {
    const res = parseDestination(src, pos, max);
    lastDestination = res.ok ? [pos, res.pos] : null;
    return res;
  };

  const rules = (md.block.ruler as unknown as { __rules__: RuleEntry[] }).__rules__;
  for (const rule of rules) {
    const original = rule.fn;
    rule.fn = (state, startLine, endLine, silent) => {
      const first = state.tokens.length;
      const start = state.bMarks[startLine] + state.tShift[startLine];
      let saved: Record<string, { href: string; title: string }> | undefined;
      if (rule.name === "reference" && !silent) {
        // Collect this definition's own destination and title, then merge, first one winning.
        saved = (state.env.references ??= {});
        state.env.references = {};
        lastDestination = null;
      }
      const ok = original(state, startLine, endLine, silent);
      if (saved) {
        const own = state.env.references as Record<string, { href: string; title: string }>;
        state.env.references = saved;
        if (ok) {
          for (const [label, def] of Object.entries(own)) {
            if (!(label in saved)) saved[label] = def;
            const tok = state.tokens[first];
            if (tok) tok.meta = { ...(tok.meta ?? {}), definition: def, destination: lastDestination ?? undefined };
          }
        }
      }
      if (ok && !silent && state.tokens.length > first) {
        const lines: ContentLine[] = [];
        for (let l = startLine; l < state.line; l++) lines.push([state.bMarks[l] + state.tShift[l], state.eMarks[l]]);
        const tok = state.tokens[first];
        tok.meta = { ...(tok.meta ?? {}), start, lines };
      }
      return ok;
    };
  }
  // A list item's marker position: when list_item_open is pushed, state.line is the item's
  // first line and its tShift has not yet been moved past the marker.
  const BaseState = md.block.State;
  class State extends BaseState {
    push(type: string, tag: string, nesting: -1 | 0 | 1): Token {
      const tok = super.push(type, tag, nesting);
      if (type === "list_item_open") tok.meta = { start: this.bMarks[this.line] + this.tShift[this.line] };
      return tok;
    }
  }
  md.block.State = State;
  return md;
}

const md = createParser();
export const normalizeLabel: (s: string) => string = md.utils.normalizeReference;

export function parseBlocks(body: BodyText): BlockResult {
  const env: Record<string, unknown> = {};
  const tokens: Token[] = [];
  md.block.parse(body.text, md, env, tokens);
  return new Converter(body, tokens).run();
}

class Converter {
  body: BodyText;
  tokens: Token[];
  i = 0;
  jobs: InlineJob[] = [];
  /** The job of each paragraph and heading, for the task marker step. */
  lineJobs = new Map<Paragraph | Heading, { node: Paragraph | Heading; lines: ContentLine[] }>();
  definitions: LinkDefinition[] = [];
  lineSpans = new Map<Block, [number, number]>();

  constructor(body: BodyText, tokens: Token[]) {
    this.body = body;
    this.tokens = tokens;
  }

  run(): BlockResult {
    const children = this.blocks(null, 0);
    return { children, definitions: this.definitions, jobs: this.jobs, lineSpans: this.lineSpans };
  }

  meta(tok: Token): TokenMeta {
    return (tok.meta ?? {}) as TokenMeta;
  }

  /** The source range of a block: from its first character to the end of its last non-blank line. */
  blockRange(tok: Token, start?: number) {
    const [l0, l1] = tok.map ?? [0, 0];
    const lines = this.body.lines;
    let last = l1 - 1;
    while (last > l0 && isBlankText(this.body.text.slice(lines[last].start, lines[last].end))) last--;
    const s = start ?? this.meta(tok).start ?? lines[l0]?.start ?? 0;
    const e = lines[last]?.end ?? s;
    return sourceRange(this.body, s, Math.max(s, e));
  }

  /** Reads blocks until the closing token `close` (or the end). */
  blocks(close: string | null, level: number): Block[] {
    const out: Block[] = [];
    while (this.i < this.tokens.length) {
      const tok = this.tokens[this.i];
      if (close !== null && tok.type === close) {
        this.i++;
        return out;
      }
      const b = this.block(level);
      if (b) out.push(b);
    }
    return out;
  }

  block(level: number): Block | null {
    const tok = this.tokens[this.i];
    switch (tok.type) {
      case "paragraph_open":
        return this.paragraph(level);
      case "heading_open":
        return this.heading(level);
      case "blockquote_open": {
        this.i++;
        const children = this.blocks("blockquote_close", level + 1);
        return { type: "blockQuote", children, range: this.blockRange(tok) };
      }
      case "bullet_list_open":
      case "ordered_list_open":
        return this.list(level);
      case "code_block":
      case "fence": {
        this.i++;
        const fenced = tok.type === "fence";
        const info = fenced ? unescapeString(tok.info.trim()) : "";
        const language = info.split(/[ \t\n]+/)[0] ?? "";
        return { type: "codeBlock", fenced, info, language, value: tok.content, range: this.blockRange(tok) };
      }
      case "hr":
        this.i++;
        return { type: "thematicBreak", range: this.blockRange(tok) };
      case "table_open":
        return this.table();
      case "reference_definition": {
        this.i++;
        const m = this.meta(tok);
        if (m.label !== undefined && m.definition) {
          const [ds, de] = m.destination ?? [0, 0];
          this.definitions.push({
            type: "definition",
            label: m.label,
            destination: m.definition.href,
            title: m.definition.title === "" ? null : m.definition.title,
            destinationRange: sourceRange(this.body, ds, de),
            range: this.blockRange(tok),
          });
        }
        return null;
      }
      default:
        // html_block is disabled; any other token is skipped.
        this.i++;
        return null;
    }
  }

  paragraph(level: number): Paragraph {
    const open = this.tokens[this.i];
    this.i += 3; // paragraph_open, inline, paragraph_close
    const lines = (this.meta(open).lines ?? []).map((l) => [...l] as ContentLine);
    const node: Paragraph = {
      type: "paragraph",
      children: [],
      tight: open.hidden,
      contentRange: { start: 0, end: 0 },
      range: this.blockRange(open),
    };
    const job = { node, lines };
    this.jobs.push(job);
    this.lineJobs.set(node, job);
    if (level === 0 && open.map) this.lineSpans.set(node, [open.map[0], open.map[1]]);
    return node;
  }

  heading(level: number): Heading {
    const open = this.tokens[this.i];
    this.i += 3; // heading_open, inline, heading_close
    const depth = Number(open.tag.slice(1)) as Heading["level"];
    const setext = open.markup === "=" || open.markup === "-";
    const all = this.meta(open).lines ?? [];
    let lines: ContentLine[];
    if (setext) {
      lines = all.slice(0, -1).map((l) => [...l] as ContentLine);
    } else {
      lines = [atxContent(this.body.text, all[0], depth)];
    }
    const node: Heading = {
      type: "heading",
      level: depth,
      setext,
      children: [],
      contentRange: { start: 0, end: 0 },
      range: this.blockRange(open),
    };
    this.jobs.push({ node, lines });
    if (level === 0 && open.map) this.lineSpans.set(node, [open.map[0], open.map[1]]);
    return node;
  }

  list(level: number): Block {
    const open = this.tokens[this.i];
    this.i++;
    const ordered = open.type === "ordered_list_open";
    const startAttr = open.attrGet("start");
    const items: ListItem[] = [];
    let tight = true;
    const close = ordered ? "ordered_list_close" : "bullet_list_close";
    while (this.i < this.tokens.length && this.tokens[this.i].type !== close) {
      const itemTok = this.tokens[this.i];
      this.i++; // list_item_open
      const firstChildIndex = this.i;
      const children = this.blocks("list_item_close", level + 2);
      const item: ListItem = { type: "listItem", children, range: this.blockRange(itemTok) };
      for (const c of children) if (c.type === "paragraph" && !c.tight) tight = false;
      this.taskMarker(item, itemTok, firstChildIndex);
      items.push(item);
    }
    this.i++; // list close
    return {
      type: "list",
      ordered,
      start: ordered ? Number(startAttr ?? 1) : 1,
      marker: ordered ? (open.markup || ".") : open.markup,
      tight,
      children: items,
      range: this.blockRange(open),
    };
  }

  /**
   * SPEC 5.1: a task list marker is `[ ]`, `[x]` or `[X]` at the start of a list item, followed
   * by a space or a tab. It is taken in step 2 and is never inline text.
   */
  taskMarker(item: ListItem, itemTok: Token, firstChildIndex: number): void {
    const first = item.children[0];
    const firstTok = this.tokens[firstChildIndex];
    if (!first || first.type !== "paragraph" || firstTok?.type !== "paragraph_open") return;
    if (!itemTok.map || !firstTok.map || firstTok.map[0] !== itemTok.map[0]) return;
    const job = this.lineJobs.get(first);
    if (!job || job.lines.length === 0) return;
    const [s, e] = job.lines[0];
    const t = this.body.text;
    const m = /^\[([ xX])\][ \t]/.exec(t.slice(s, e));
    if (!m) return;
    item.task = { checked: m[1] !== " ", range: sourceRange(this.body, s, s + 3) };
    let p = s + 3;
    while (p < e && (t[p] === " " || t[p] === "\t")) p++;
    job.lines[0] = [p, e];
    if (p >= e && job.lines.length > 1) job.lines.shift();
  }

  table(): Block {
    const open = this.tokens[this.i];
    const lines = this.meta(open).lines ?? [];
    const map = open.map ?? [0, 0];
    const align: Alignment[] = [];
    const rows: TableRow[] = [];
    let head: TableRow | null = null;
    let inHead = false;
    this.i++;
    while (this.i < this.tokens.length && this.tokens[this.i].type !== "table_close") {
      const tok = this.tokens[this.i];
      if (tok.type === "thead_open") inHead = true;
      else if (tok.type === "thead_close") inHead = false;
      else if (tok.type === "th_open") {
        const style = String(tok.attrGet("style") ?? "");
        const m = /text-align:(left|center|right)/.exec(style);
        align.push(m ? (m[1] as Alignment) : null);
      } else if (tok.type === "tr_open" && tok.map) {
        const lineNo = tok.map[0];
        const row = this.tableRow(lines[lineNo - map[0]], inHead ? null : align.length);
        if (inHead) head = row;
        else rows.push(row);
      }
      this.i++;
    }
    this.i++; // table_close
    const header = head ?? { type: "tableRow" as const, cells: [], range: this.blockRange(open) };
    // markdown-it and this splitter agree on the header; pad or cut it to the alignment row.
    while (header.cells.length > align.length) header.cells.pop();
    return { type: "table", align, head: header, body: rows, range: this.blockRange(open) };
  }

  /**
   * GFM table row: cells are split at unescaped `|`; a leading and a trailing pipe are optional.
   * `\|` stands for a `|` in the cell's text, also inside code spans. Each cell is a block of
   * its own for inline parsing (SPEC 5). A body row with fewer cells gets empty cells, and
   * excess cells are ignored (GFM).
   */
  tableRow(line: ContentLine, columns: number | null): TableRow {
    const t = this.body.text;
    const [s] = line;
    let e = line[1];
    while (e > s && (t[e - 1] === " " || t[e - 1] === "\t")) e--;
    const bounds = rowCells(t, s, e);
    const cells: TableCell[] = [];
    for (const [cs, ce] of bounds) {
      const cell: TableCell = { type: "tableCell", children: [], range: sourceRange(this.body, cs, ce) };
      this.jobs.push({ node: cell, input: this.cellInput(cs, ce) });
      cells.push(cell);
    }
    if (columns !== null) {
      while (cells.length > columns) cells.pop();
      while (cells.length < columns) {
        const at = sourceRange(this.body, e, e);
        const cell: TableCell = { type: "tableCell", children: [], range: at };
        cells.push(cell);
      }
    }
    return { type: "tableRow", cells, range: sourceRange(this.body, s, e) };
  }

  /** The inline text of a cell, with `\|` turned into `|`. */
  cellInput(s: number, e: number): InlineInput {
    const t = this.body.text;
    let text = "";
    const offsets: number[] = [];
    for (let p = s; p < e; p++) {
      if (t[p] === "\\" && t[p + 1] === "|" && p + 1 < e) {
        text += "|";
        offsets.push(this.body.toSource[p + 1]);
        p++;
        continue;
      }
      text += t[p];
      offsets.push(this.body.toSource[p]);
    }
    offsets.push(this.body.toSource[e]);
    return { text, offsets, source: this.body.source };
  }
}

/**
 * GFM table row splitting, used both to decide the table's structure (gfmTable) and to cut a row
 * into cells: cells are separated by `|`; a backslash and the character after it are a pair, so
 * `\|` is a pipe inside a cell and in `\\|` the backslash is escaped and the `|` separates
 * cells. A leading and a trailing pipe are optional. Returns each cell's bounds, trimmed of
 * spaces and tabs.
 */
export function rowCells(t: string, s: number, e: number): [number, number][] {
  while (e > s && (t[e - 1] === " " || t[e - 1] === "\t")) e--;
  while (s < e && (t[s] === " " || t[s] === "\t")) s++;
  const raw: [number, number][] = [];
  let p = s;
  if (t[p] === "|") p++;
  let cellStart = p;
  while (p < e) {
    const c = t[p];
    if (c === "\\" && p + 1 < e) {
      p += 2;
      continue;
    }
    if (c === "|") {
      raw.push([cellStart, p]);
      cellStart = p + 1;
    }
    p++;
  }
  // The text after the last pipe is a cell, unless the row ended with that pipe.
  if (cellStart < e) raw.push([cellStart, e]);
  return raw.map(([a, b]) => {
    while (a < b && (t[a] === " " || t[a] === "\t")) a++;
    while (b > a && (t[b - 1] === " " || t[b - 1] === "\t")) b--;
    return [a, b];
  });
}

/** The longest run of missing body cells a table may fill in (markdown-it's limit). */
const MAX_AUTOCOMPLETED_CELLS = 0x10000;

/**
 * The GFM table block rule. It follows markdown-it's table rule, except that the header and body
 * rows are split with rowCells(), so that the structure is decided by the same splitting that
 * makes the cells.
 */
function gfmTable(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  if (startLine + 2 > endLine) return false;
  const src = state.src;
  const isSp = (c: number) => c === 0x20 || c === 0x09;
  const lineBounds = (l: number): [number, number] => [state.bMarks[l] + state.tShift[l], state.eMarks[l]];
  let nextLine = startLine + 1;
  if (state.sCount[nextLine] < state.blkIndent) return false;
  if (state.sCount[nextLine] - state.blkIndent >= 4) return false;
  // The delimiter row: only |, -, :, spaces and tabs, starting with |, - or :.
  let pos = state.bMarks[nextLine] + state.tShift[nextLine];
  const max = state.eMarks[nextLine];
  if (pos >= max) return false;
  const first = src.charCodeAt(pos++);
  if (first !== 0x7c && first !== 0x2d && first !== 0x3a) return false;
  if (pos >= max) return false;
  const second = src.charCodeAt(pos++);
  if (second !== 0x7c && second !== 0x2d && second !== 0x3a && !isSp(second)) return false;
  if (first === 0x2d && isSp(second)) return false;
  while (pos < max) {
    const ch = src.charCodeAt(pos);
    if (ch !== 0x7c && ch !== 0x2d && ch !== 0x3a && !isSp(ch)) return false;
    pos++;
  }
  const delim = src.slice(...lineBounds(nextLine)).split("|");
  const aligns: string[] = [];
  for (let i = 0; i < delim.length; i++) {
    const cell = delim[i].trim();
    if (!cell) {
      if (i === 0 || i === delim.length - 1) continue;
      return false;
    }
    if (!/^:?-+:?$/.test(cell)) return false;
    if (cell.endsWith(":")) aligns.push(cell.startsWith(":") ? "center" : "right");
    else if (cell.startsWith(":")) aligns.push("left");
    else aligns.push("");
  }
  // The header row: it holds a pipe and has as many cells as the delimiter row.
  const [hs, he] = lineBounds(startLine);
  if (src.slice(hs, he).indexOf("|") === -1) return false;
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const columnCount = rowCells(src, hs, he).length;
  if (columnCount === 0 || columnCount !== aligns.length) return false;
  if (silent) return true;

  const oldParentType = state.parentType;
  state.parentType = "table";
  const terminatorRules = state.md.block.ruler.getRules("blockquote");
  const tableOpen = state.push("table_open", "table", 1);
  const tableLines: [number, number] = [startLine, 0];
  tableOpen.map = tableLines;
  state.push("thead_open", "thead", 1).map = [startLine, startLine + 1];
  state.push("tr_open", "tr", 1).map = [startLine, startLine + 1];
  for (let i = 0; i < columnCount; i++) {
    const th = state.push("th_open", "th", 1);
    if (aligns[i]) th.attrs = [["style", `text-align:${aligns[i]}`]];
    state.push("th_close", "th", -1);
  }
  state.push("tr_close", "tr", -1);
  state.push("thead_close", "thead", -1);
  let tbodyLines: [number, number] | null = null;
  let autocompleted = 0;
  for (nextLine = startLine + 2; nextLine < endLine; nextLine++) {
    if (state.sCount[nextLine] < state.blkIndent) break;
    let terminate = false;
    for (const rule of terminatorRules) {
      if (rule(state, nextLine, endLine, true)) {
        terminate = true;
        break;
      }
    }
    if (terminate) break;
    const [bs, be] = lineBounds(nextLine);
    if (!src.slice(bs, be).trim()) break;
    if (state.sCount[nextLine] - state.blkIndent >= 4) break;
    autocompleted += Math.max(0, columnCount - rowCells(src, bs, be).length);
    if (autocompleted > MAX_AUTOCOMPLETED_CELLS) break;
    if (tbodyLines === null) {
      tbodyLines = [startLine + 2, 0];
      state.push("tbody_open", "tbody", 1).map = tbodyLines;
    }
    state.push("tr_open", "tr", 1).map = [nextLine, nextLine + 1];
    state.push("tr_close", "tr", -1);
  }
  if (tbodyLines) {
    state.push("tbody_close", "tbody", -1);
    tbodyLines[1] = nextLine;
  }
  state.push("table_close", "table", -1);
  tableLines[1] = nextLine;
  state.parentType = oldParentType;
  state.line = nextLine;
  return true;
}

/** The content of an ATX heading line: after the opening `#`s, without a closing sequence. */
function atxContent(t: string, line: ContentLine, level: number): ContentLine {
  const [s, e] = line;
  let cs = s + level;
  while (cs < e && (t[cs] === " " || t[cs] === "\t")) cs++;
  let ce = e;
  while (ce > cs && (t[ce - 1] === " " || t[ce - 1] === "\t")) ce--;
  let k = ce;
  while (k > cs && t[k - 1] === "#") k--;
  if (k < ce) {
    if (k === cs) ce = cs;
    else if (t[k - 1] === " " || t[k - 1] === "\t") {
      ce = k;
      while (ce > cs && (t[ce - 1] === " " || t[ce - 1] === "\t")) ce--;
    }
  }
  return [cs, ce];
}

/** Builds the inline text of a paragraph or heading from its lines. */
export function linesInput(body: BodyText, lines: readonly ContentLine[]): InlineInput {
  let text = "";
  const offsets: number[] = [];
  lines.forEach(([s, e], k) => {
    if (k > 0) {
      text += "\n";
      offsets.push(body.toSource[lines[k - 1][1]]);
    }
    text += body.text.slice(s, e);
    for (let p = s; p < e; p++) offsets.push(body.toSource[p]);
  });
  // CommonMark: final spaces or tabs of a paragraph or heading are stripped.
  let n = text.length;
  while (n > 0 && (text[n - 1] === " " || text[n - 1] === "\t")) n--;
  text = text.slice(0, n);
  offsets.length = n;
  const endPos = lines.length > 0 ? lines[lines.length - 1][0] : 0;
  const last = n > 0 ? offsets[n - 1] : body.toSource[endPos];
  const after = n > 0 ? last + (body.source.charCodeAt(last) === 0x0d && body.source.charCodeAt(last + 1) === 0x0a ? 2 : 1) : last;
  offsets.push(after);
  return { text, offsets, source: body.source };
}
