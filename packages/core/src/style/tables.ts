// Tables edited as a grid in rich mode: a table's Markdown is read into cells, changed, and
// written again. Only plain pipe tables are taken (every line `| a | b |`, at the left margin or
// indented up to three spaces); any other table is left to "Edit as text".

import { parseNote } from "../../../../noteformat/src/index.ts";

export interface Grid {
  /** What stands before the first pipe of every line. */
  indent: string;
  /** The cells of the line under the header (`---`, `:--`, `--:`, `:-:`), one per column. */
  align: string[];
  /** The rows, the header first; each cell is its text as written, with `\|` shown as `|`. */
  rows: string[][];
  /** The line ending of the table. */
  eol: string;
}

/** The cells of one line, or null if it is not `| ... |`. */
function splitRow(line: string): string[] | null {
  const m = /^( {0,3})\|(.*)\|[ \t]*$/.exec(line);
  if (!m) return null;
  const cells: string[] = [];
  let cur = "";
  const body = m[2];
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\" && body[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (body[i] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += body[i];
  }
  cells.push(cur.trim());
  return cells;
}

/** Reads a table's Markdown; null if it is not a plain pipe table. */
export function parseTable(src: string): Grid | null {
  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  const lines = src.split(/\r?\n/);
  if (lines.length < 2 || lines.some((l) => l.includes("\r"))) return null;
  const indent = /^ {0,3}/.exec(lines[0])![0];
  const rows: string[][] = [];
  for (const l of lines) {
    if (!l.startsWith(indent + "|")) return null;
    const cells = splitRow(l);
    if (!cells) return null;
    rows.push(cells);
  }
  const align = rows[1];
  const n = rows[0].length;
  if (n === 0 || align.length !== n || !align.every((c) => /^:?-+:?$/.test(c))) return null;
  // A row that is short or long is read as the renderer reads it: filled up or cut off.
  const cells = [rows[0], ...rows.slice(2)].map((r) => Array.from({ length: n }, (_, i) => r[i] ?? ""));
  return { indent, align, rows: cells, eol };
}

/** A cell's text as it is written in the table: on one line, with its pipes escaped. */
function writeCell(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ").trim().replace(/\\?\|/g, "\\|");
}

/** Writes a grid as Markdown. */
export function writeTable(g: Grid): string {
  const line = (cells: string[]) => `${g.indent}| ${cells.map((c) => (c === "" ? " " : c)).join(" | ").replace(/ {2,}\|/g, " |")} |`.replace(/\| {2,}/g, "| ");
  const out = [line(g.rows[0].map(writeCell)), line(g.align), ...g.rows.slice(1).map((r) => line(r.map(writeCell)))];
  return out.join(g.eol);
}

export type TableEdit = { ok: true; text: string; from: number; to: number } | { ok: false; reason: string };

/**
 * Puts a changed grid in place of the table at `from`..`to` of a note's text. The result is
 * checked: the new Markdown must read back as the same cells, and the note must have a table
 * exactly there, with nothing else in the note touched.
 */
export function replaceTable(text: string, from: number, to: number, g: Grid): TableEdit {
  const n = g.rows[0]?.length ?? 0;
  if (n === 0 || g.rows.some((r) => r.length !== n) || g.align.length !== n) return { ok: false, reason: "the table's rows do not have the same number of cells" };
  const src = writeTable(g);
  const back = parseTable(src);
  const want = g.rows.map((r) => r.map((c) => c.replace(/\s*[\r\n]+\s*/g, " ").trim()));
  if (!back || JSON.stringify(back.rows) !== JSON.stringify(want)) return { ok: false, reason: "this text cannot be written in a table cell; use Edit as text" };
  const out = text.slice(0, from) + src + text.slice(to);
  const end = from + src.length;
  type B = { type: string; range: { start: number; end: number }; children?: B[] };
  let found = false;
  const look = (bs: B[]) => {
    for (const b of bs) {
      if (b.type === "table" && b.range.start >= from && b.range.start <= from + g.indent.length && b.range.end >= end - 1 && b.range.end <= end + 2) found = true;
      else if (b.children && (b.type === "list" || b.type === "listItem" || b.type === "blockQuote")) look(b.children);
    }
  };
  look(parseNote(out).children as unknown as B[]);
  if (!found) return { ok: false, reason: "the table would not read as a table any more; use Edit as text" };
  return { ok: true, text: out, from, to: end };
}

/** A new empty row or column, or one fewer; the header row and the last column stay. */
export function addRow(g: Grid, after: number): Grid {
  const rows = g.rows.slice();
  rows.splice(Math.max(1, after + 1), 0, g.rows[0].map(() => ""));
  return { ...g, rows };
}

export function addColumn(g: Grid, after: number): Grid {
  const at = after + 1;
  return { ...g, align: [...g.align.slice(0, at), "---", ...g.align.slice(at)], rows: g.rows.map((r) => [...r.slice(0, at), "", ...r.slice(at)]) };
}

export function removeRow(g: Grid, row: number): Grid | null {
  if (row < 1 || row >= g.rows.length) return null;
  return { ...g, rows: g.rows.filter((_, i) => i !== row) };
}

export function removeColumn(g: Grid, col: number): Grid | null {
  if (g.align.length < 2 || col < 0 || col >= g.align.length) return null;
  return { ...g, align: g.align.filter((_, i) => i !== col), rows: g.rows.map((r) => r.filter((_, i) => i !== col)) };
}
