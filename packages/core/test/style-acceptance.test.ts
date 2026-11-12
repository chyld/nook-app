// EDITOR-PLAN 9, acceptance: the must-succeed list, and the refusal rate over the demo notes and
// the spec's examples, for every word and every pair of neighbouring words, with each toolbar
// style. Every result that is not a refusal is also judged by the independent checker.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { styleRuns } from "../../../noteformat/src/index.ts";
import { applyStyle, type Change } from "../src/style/apply.ts";
import { selectVisible } from "../src/style/visible.ts";
import { typeText } from "../src/style/typing.ts";
import { judge, oracleChars, type OChange } from "./style-oracle.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..", "..", "..");

/** The corpus: the demo notes of the running stack (fixture) and the spec's examples. */
export function corpus(): { name: string; text: string }[] {
  const demo = JSON.parse(readFileSync(path.join(here, "fixtures", "demo-notes.json"), "utf8")) as { name: string; text: string }[];
  const spec = readFileSync(path.join(repo, "SPEC.md"), "utf8");
  const examples: { name: string; text: string }[] = [];
  const re = /^(`{3,})(markdown)?\n([\s\S]*?)\n\1$/gm;
  let k = 0;
  for (const m of spec.matchAll(re)) {
    if (/^(js|python)/.test(m[3])) continue;
    examples.push({ name: `SPEC example ${++k}`, text: m[3] + "\n" });
  }
  examples.push({ name: "lisbon-trip.md", text: readFileSync(path.join(repo, "noteformat", "examples", "lisbon-trip.md"), "utf8") });
  return [...demo, ...examples];
}

/** The toolbar's styles, as it decides them for a selection (on/off for the toggles). */
function toolbar(text: string, from: number, to: number): { name: string; change: Change }[] {
  const chars = styleRuns(text).chars.filter((c) => c.start >= from && c.end <= to);
  const all = (f: (s: (typeof chars)[0]["style"]) => boolean) => chars.length > 0 && chars.every((c) => f(c.style));
  return [
    { name: "bold", change: { kind: "bold", on: !all((s) => s.bold) } },
    { name: "italic", change: { kind: "italic", on: !all((s) => s.italic) } },
    { name: "underline", change: { kind: "underline", on: !all((s) => s.underline) } },
    { name: "strike", change: { kind: "strike", on: !all((s) => s.strike) } },
    { name: "colour", change: { kind: "color", value: "red" } },
    { name: "colour none", change: { kind: "color", value: null } },
    { name: "highlight", change: { kind: "bg", value: "mint" } },
    { name: "highlight none", change: { kind: "bg", value: null } },
    { name: "font", change: { kind: "font", value: "IBM Plex Serif" } },
    { name: "font default", change: { kind: "font", value: null } },
    { name: "size 14", change: { kind: "size", pt: 14 } },
    { name: "size 12", change: { kind: "size", pt: 12 } },
    { name: "size +", change: { kind: "size-step", dir: 1 } },
    { name: "size -", change: { kind: "size-step", dir: -1 } },
    { name: "clear", change: { kind: "clear" } },
  ];
}

function oracleChange(c: Change): OChange | null {
  switch (c.kind) {
    case "color":
    case "bg":
      return { prop: c.kind, value: c.value };
    case "font":
      return { prop: "font", value: c.value };
    case "size":
      return { prop: "size", value: c.pt };
    case "size-step":
      return { prop: "step", dir: c.dir };
    case "underline":
      return { prop: "u", value: c.on };
    case "bold":
      return { prop: "b", value: c.on };
    case "italic":
      return { prop: "i", value: c.on };
    case "strike":
      return { prop: "s", value: c.on };
    default:
      return null;
  }
}

/** Words of the visible text, as visible index ranges, outside code blocks. */
function words(text: string): [number, number][] {
  const r = styleRuns(text);
  const out: [number, number][] = [];
  let s = -1;
  for (let i = 0; i <= r.chars.length; i++) {
    const c = r.chars[i];
    const inWord = c !== undefined && c.kind === "text" && !/\s/u.test(c.ch) && r.blocks[c.block].kind !== "code";
    const sameBlock = c !== undefined && s >= 0 && r.chars[s].block === c.block;
    if (inWord && (s < 0 || sameBlock)) {
      if (s < 0) s = i;
    } else {
      if (s >= 0) out.push([s, i]);
      s = inWord ? i : -1;
    }
  }
  return out;
}

const MUST: [string, string, Change, string][] = [
  ["colouring a bold word in the middle of a sentence", "The **quick** brown fox.", { kind: "color", value: "red" }, "quick"],
  ["sizing one word of a coloured span", "A [quick brown fox]{color=red} jumps.", { kind: "size", pt: 14 }, "brown"],
  ["sizing half of a bold word inside a span", "A [very **bold** word]{color=red}.", { kind: "size", pt: 18 }, "bo"],
  ["turning underline off for the middle of an underlined phrase", "++one two three++", { kind: "underline", on: false }, "two"],
  ["colouring part of a web address", "See https://example.com/page now.", { kind: "color", value: "red" }, "example"],
  ["sizing a whole heading", "# A heading\n\nText.", { kind: "size", pt: 30 }, "A heading"],
  ["sizing a whole list item", "- buy milk\n- buy bread", { kind: "size", pt: 14 }, "buy milk"],
  ["sizing a sentence that contains inline code", "Run `npm test` now.", { kind: "size", pt: 14 }, "Run npm test now."],
  ["choosing the normal size on a sized word", "A [big]{size=18pt} word.", { kind: "size", pt: 12 }, "big"],
  ["styling a selection across three paragraphs", "One here.\n\nTwo here.\n\nThree here.", { kind: "color", value: "teal" }, "here.Two here.Three"],
];

test("acceptance 9.1: the must-succeed list", () => {
  for (const [what, text, change, sel] of MUST) {
    const { from, to } = selectVisible(text, sel);
    const r = applyStyle(text, from, to, change);
    assert.ok(r.ok, `${what}: refused: ${r.ok ? "" : r.reason}`);
    assert.notEqual(r.text, text, what);
    const shown = styleRuns(text).chars.map((c) => c.ch).join("");
    const a = shown.indexOf(sel);
    const verdict = judge(text, r.text, [a, a + sel.length], oracleChange(change)!, null);
    assert.equal(verdict, null, `${what}: ${verdict}\n${r.text}`);
  }
});

test("acceptance 9.1: typing at the end of bold text (judged by the separate checker)", () => {
  for (const [text, at] of [["The **quick** fox.", 11], ["The **quick** fox.", 13], ["The __quick__ fox.", 13]] as const) {
    let t: string = text;
    let p: number = at;
    for (const ch of "er") {
      const r = typeText(t, p, p, ch);
      assert.ok(r.ok, r.ok ? "" : r.reason);
      t = r.text;
      p = r.cursor;
    }
    const o = oracleChars(t).chars;
    assert.equal(o.map((c) => c.ch).join(""), "The quicker fox.");
    const word = o.slice(4, 11);
    assert.ok(word.every((c) => c.look.b), `${t}: all of "quicker" is bold`);
    assert.ok(!o[3].look.b && !o[12].look.b, t);
  }
});

test("acceptance 9.2: refusals are rare over the demo notes and the spec's examples", { timeout: 900_000 }, () => {
  let total = 0;
  let done = 0;
  const kinds = new Map<string, number>();
  const wrong: string[] = [];
  const examples = new Map<string, string>();
  for (const note of corpus()) {
    const text = note.text;
    const r = styleRuns(text);
    const ws = words(text);
    const sels: [number, number][] = [...ws];
    for (let k = 0; k + 1 < ws.length; k++) if (r.chars[ws[k][0]].block === r.chars[ws[k + 1][0]].block) sels.push([ws[k][0], ws[k + 1][1]]);
    const ochars = oracleChars(text).chars;
    assert.equal(ochars.map((c) => c.ch).join(""), r.chars.map((c) => c.ch).join(""), note.name);
    const noteFont = (/^font: (.*)$/m.exec(text.split("\n---")[0])?.[1] ?? null) as string | null;
    for (const [a, b] of sels) {
      const from = r.chars[a].start;
      const to = r.chars[b - 1].end;
      for (const { name, change } of toolbar(text, from, to)) {
        total++;
        const res = applyStyle(text, from, to, change);
        if (!res.ok) {
          const key = `${name}: ${res.reason}`;
          kinds.set(key, (kinds.get(key) ?? 0) + 1);
          if (!examples.has(key)) examples.set(key, `${note.name}: "${r.chars.slice(a, b).map((c) => c.ch).join("")}"`);
          continue;
        }
        done++;
        const oc = oracleChange(change);
        if (!oc || res.applied.length !== b - a) continue;
        const v = judge(text, res.text, [a, b], oc, noteFont);
        if (v) wrong.push(`${note.name} "${r.chars.slice(a, b).map((c) => c.ch).join("")}" ${name}: ${v}`);
      }
    }
  }
  const rate = (100 * done) / total;
  const lines = [...kinds].sort((x, y) => y[1] - x[1]).map(([k, n]) => `  ${n} × ${k} (e.g. ${examples.get(k)})`);
  console.log(`acceptance: ${total} requests, ${done} succeeded (${rate.toFixed(2)}%), ${total - done} refused\n${lines.join("\n")}`);
  assert.deepEqual(wrong.slice(0, 10), []);
  assert.ok(rate >= 99, `success rate ${rate.toFixed(2)}% is below 99%`);
});

