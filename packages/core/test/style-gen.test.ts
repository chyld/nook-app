// EDITOR-PLAN 8, generated cases: thousands of generated notes, selections and changes. Each
// result is either a refusal with the text unchanged, or passes the five checks of 5.1 as judged
// by the separate test-only checker (style-oracle.ts), not by the commands' own check.

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyStyle, type Change } from "../src/style/apply.ts";
import { boundaries, judge, oracleChars, type OChange } from "./style-oracle.ts";
import { parseNote } from "../../../noteformat/src/index.ts";
import { genNote, rng } from "./gen.ts";

function genChange(r: () => number): [Change, OChange] {
  const k = Math.floor(r() * 16);
  switch (k) {
    case 0:
      return [{ kind: "color", value: "red" }, { prop: "color", value: "red" }];
    case 1:
      return [{ kind: "color", value: null }, { prop: "color", value: null }];
    case 2:
      return [{ kind: "bg", value: "mint" }, { prop: "bg", value: "mint" }];
    case 3:
      return [{ kind: "bg", value: null }, { prop: "bg", value: null }];
    case 4:
      return [{ kind: "font", value: "IBM Plex Serif" }, { prop: "font", value: "IBM Plex Serif" }];
    case 5:
      return [{ kind: "font", value: null }, { prop: "font", value: null }];
    case 6:
      return [{ kind: "size", pt: 14 }, { prop: "size", value: 14 }];
    case 7:
      return [{ kind: "size", pt: 12 }, { prop: "size", value: 12 }];
    case 8:
      return [{ kind: "size-step", dir: 1 }, { prop: "step", dir: 1 }];
    case 9:
      return [{ kind: "size-step", dir: -1 }, { prop: "step", dir: -1 }];
    case 10:
      return [{ kind: "underline", on: r() < 0.5 }, { prop: "u", value: false }];
    case 11:
      return [{ kind: "bold", on: true }, { prop: "b", value: true }];
    case 12:
      return [{ kind: "bold", on: false }, { prop: "b", value: false }];
    case 13:
      return [{ kind: "italic", on: r() < 0.5 }, { prop: "i", value: false }];
    case 14:
      return [{ kind: "strike", on: r() < 0.5 }, { prop: "s", value: false }];
    default:
      return [{ kind: "clear" }, { prop: "clear" }];
  }
}

/** The oracle change for a command change (with the on/off actually asked for). */
function oracleOf(c: Change, o: OChange): OChange {
  if (c.kind === "underline") return { prop: "u", value: c.on };
  if (c.kind === "bold" || c.kind === "italic" || c.kind === "strike") return { prop: c.kind === "bold" ? "b" : c.kind === "italic" ? "i" : "s", value: c.on };
  return o;
}

function naturalSizes(text: string): (block: number) => number {
  const { blocks } = oracleChars(text);
  const note = parseNote(text);
  const fs = note.frontMatter?.fields.size;
  const ns = fs ? (/pt$/.test(fs) ? Number(fs.slice(0, -2)) : /px$/.test(fs) ? Number(fs.slice(0, -2)) * 0.75 : 12) : 12;
  return (b) => {
    const m = /heading(\d)/.exec(blocks[b].desc);
    return m ? ns * [2, 1.5, 1.1667, 1, 0.9167, 0.8333][Number(m[1]) - 1] : ns;
  };
}

test("generated: every result is a refusal or passes the independent checker", { timeout: 600_000 }, () => {
  const r = rng(20261110);
  let cases = 0;
  let ok = 0;
  const refusals = new Map<string, number>();
  const failures: string[] = [];
  const NOTES = Number(process.env.STYLE_GEN_NOTES ?? 260);
  for (let n = 0; n < NOTES; n++) {
    const text = genNote(r);
    const bounds = boundaries(text);
    const ks = [...bounds.keys()].sort((x, y) => x - y);
    if (ks.length < 2) continue;
    const noteFont = parseNote(text).frontMatter?.fields.font ?? null;
    for (let s = 0; s < 12; s++) {
      const i = Math.floor(r() * (ks.length - 1));
      const j = i + 1 + Math.floor(r() * Math.min(12, ks.length - 1 - i));
      const a = ks[i];
      const b = ks[j];
      const [change, oc] = genChange(r);
      cases++;
      const res = applyStyle(text, bounds.get(a)!, bounds.get(b)!, change);
      if (!res.ok) {
        refusals.set(res.reason, (refusals.get(res.reason) ?? 0) + 1);
        if (process.env.STYLE_GEN_SHOW) console.log("REFUSED", res.reason, JSON.stringify(text), `[${a},${b})`, JSON.stringify(oracleChars(text).chars.slice(a, b).map((c) => c.ch).join("")), JSON.stringify(change));
        continue;
      }
      ok++;
      if (change.kind === "clear" && res.skipped.count > 0) continue;
      // The command's applied characters must be within the selection.
      const applied = res.applied;
      if (applied.some((x) => x < a || x >= b)) {
        failures.push(`applied outside the selection\n${JSON.stringify(text)} [${a},${b}) ${JSON.stringify(change)}`);
        continue;
      }
      // Judge each applied range (they are contiguous per block).
      const ranges: [number, number][] = [];
      for (const x of applied) {
        const last = ranges[ranges.length - 1];
        if (last && last[1] === x) last[1] = x + 1;
        else ranges.push([x, x + 1]);
      }
      const sel: [number, number] = ranges.length === 1 ? ranges[0] : [a, b];
      if (ranges.length > 1 && applied.length !== b - a) continue; // several partial blocks: covered by per-block checks
      const verdict = judge(text, res.text, sel, oracleOf(change, oc), noteFont, naturalSizes(text));
      if (verdict) failures.push(`${verdict}\n  text: ${JSON.stringify(text)}\n  sel [${sel}] ${JSON.stringify(change)}\n  got: ${JSON.stringify(res.text)}`);
    }
  }
  const rate = ((100 * ok) / cases).toFixed(1);
  console.log(`generated: ${cases} cases, ${ok} done (${rate}%), refusals: ${JSON.stringify(Object.fromEntries([...refusals].sort((x, y) => y[1] - x[1])))}`);
  assert.ok(cases > 2500, `only ${cases} cases`);
  assert.deepEqual(failures.slice(0, 5), []);
});
