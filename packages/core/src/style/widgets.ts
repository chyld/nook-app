// Rich mode's widgets (EDITOR-PLAN 3.5): a photo's width, a task's checkbox, a link's range.
// Each is a checked edit to the raw text.

import { styleKey } from "../../../../noteformat/src/index.ts";
import { buildModel, type Model } from "./model.ts";

export type WidgetEdit = { ok: true; text: string } | { ok: false; reason: string };

export const WIDTHS = ["25%", "50%", "75%", "100%"];

function sameVisible(a: Model, b: Model): boolean {
  return a.chars.length === b.chars.length && a.chars.every((c, i) => c.ch === b.chars[i].ch && c.kind === b.chars[i].kind && styleKey(c.style) === styleKey(b.chars[i].style) && c.block === b.chars[i].block);
}

/** Sets the width of the photo that is visible character `i` (SPEC 5.4, image case). */
export function setImageWidth(text: string, i: number, width: string): WidgetEdit {
  const m = buildModel(text);
  const c = m.chars[i];
  if (!c || c.kind !== "image") return { ok: false, reason: "this is not a photo" };
  const b = m.blocks[c.block];
  if (b.vb - b.va !== 1 || b.info.kind !== "paragraph" || !b.info.topLevel) return { ok: false, reason: "a width is set on a photo on a line of its own" };
  const pb = b.block as { attributes?: { target: string; range: { start: number; end: number } } } | null;
  const tries: string[] = [];
  if (pb?.attributes && pb.attributes.target === "image") {
    const { start, end } = pb.attributes.range;
    const line = text.slice(start, end);
    const next = /width=[^\s}]+/.test(line) ? line.replace(/width=[^\s}]+/, `width=${width}`) : line.replace(/\}\s*$/, (x) => ` width=${width}${x}`);
    tries.push(text.slice(0, start) + next + text.slice(end));
  } else {
    const at = b.info.range.end;
    const rest = text.slice(at);
    tries.push(text.slice(0, at) + `\n{width=${width}}` + (rest === "" || /^(\r?\n)[ \t]*(\r?\n|$)/.test(rest) ? "" : "\n") + rest);
    tries.push(text.slice(0, at) + `\n{width=${width}}\n` + rest);
  }
  for (const t of tries) {
    const nm = buildModel(t);
    if (nm.chars.length !== m.chars.length) continue;
    if (!nm.chars.every((x, n) => x.ch === m.chars[n].ch && (n === i || styleKey(x.style) === styleKey(m.chars[n].style)))) continue;
    if (nm.chars[i].image?.width !== width) continue;
    return { ok: true, text: t };
  }
  return { ok: false, reason: "the width could not be written here; edit it in Raw" };
}

interface TaskNode {
  type: string;
  task?: { checked: boolean; range: { start: number; end: number } };
  children?: TaskNode[];
}

/** The task markers of a note: where `[ ]` or `[x]` is, and whether it is checked. */
export function tasks(m: Model): { start: number; end: number; checked: boolean }[] {
  const out: { start: number; end: number; checked: boolean }[] = [];
  const walk = (ns: TaskNode[]) => {
    for (const n of ns) {
      if (n.task) out.push({ ...n.task.range, checked: n.task.checked });
      if (n.children) walk(n.children);
    }
  };
  walk(m.note.children as unknown as TaskNode[]);
  return out;
}

/** Checks or unchecks the task whose marker is on the line of `pos`. */
export function toggleTask(text: string, pos: number): WidgetEdit {
  const m = buildModel(text);
  let ls = pos;
  while (ls > 0 && text[ls - 1] !== "\n") ls--;
  let le = pos;
  while (le < text.length && text[le] !== "\n") le++;
  const t = tasks(m).find((x) => x.start >= ls && x.start <= le);
  if (!t) return { ok: false, reason: "there is no task here" };
  const inner = t.start + 1;
  const out = text.slice(0, inner) + (t.checked ? " " : "x") + text.slice(inner + 1);
  const nm = buildModel(out);
  const after = tasks(nm).find((x) => x.start === t.start);
  if (!after || after.checked === t.checked || !sameVisible(m, nm)) return { ok: false, reason: "the task could not be changed; edit it in Raw" };
  return { ok: true, text: out };
}

/** The visible characters [a, b) of the link around position `pos`, and its address. */
export function linkAt(text: string, pos: number): { from: number; to: number; url: string } | null {
  const m = buildModel(text);
  let k = m.chars.findIndex((c) => c.start <= pos && c.end > pos);
  if (k < 0) k = m.chars.findIndex((c) => c.start >= pos);
  if (k < 0 || !m.chars[k].style.link) return null;
  const url = m.chars[k].style.link as string;
  let a = k;
  while (a > 0 && m.chars[a - 1].style.link === url && m.chars[a - 1].block === m.chars[k].block) a--;
  let b = k + 1;
  while (b < m.chars.length && m.chars[b].style.link === url && m.chars[b].block === m.chars[k].block) b++;
  return { from: m.chars[a].start, to: m.chars[b - 1].end, url };
}
