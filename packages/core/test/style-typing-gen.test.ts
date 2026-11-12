// EDITOR-PLAN 8, typing and deleting by generated cases: random typing, deleting, pasting and
// Enter in rich mode over generated notes. After each step the visible text is what a plain text
// editor would hold, and the characters not edited keep their look, as judged by the separate
// test-only checker (style-oracle.ts). A refusal must leave the text unchanged.

import { test } from "node:test";
import assert from "node:assert/strict";
import { deleteAt, deleteRange, enter, pastePlain, typeText, type Edit } from "../src/style/typing.ts";
import { oracleChars, type OChar } from "./style-oracle.ts";
import { genNote, rng } from "./gen.ts";
import { buildModel } from "../src/style/model.ts";

const TYPED = ["a", "b", "Z", " ", " ", "*", "_", "[", "]", "{", "}", "#", "`", "~", "=", "+", "<", ">", "&", "\\", "!", "1", ".", "-", "|", "é", "("];
const NOTES = Number(process.env.TYPE_GEN_NOTES ?? 160);
const STEPS = 25;

const lookKey = (c: OChar) => {
  const l = { ...c.look };
  if (/\s/.test(c.ch)) {
    l.b = false;
    l.i = false;
  }
  return JSON.stringify(l);
};

/** The note's blocks as a plain text editor holds them: text per block, ends trimmed. */
function blocksOf(text: string, o = oracleChars(text)): { text: string; chars: OChar[] }[] {
  const out: { text: string; chars: OChar[] }[] = [];
  let cur = -1;
  for (const c of o.chars) {
    if (c.block !== cur) {
      out.push({ text: "", chars: [] });
      cur = c.block;
    }
    out[out.length - 1].text += c.kind === "hard" ? "\n" : c.ch;
    out[out.length - 1].chars.push(c);
  }
  return out;
}

const trimmed = (bs: string[]) => bs.map((b) => b.replace(/^\s+|\s+$/g, "")).filter((b) => b !== "");

test("generated typing, deleting, pasting and Enter: the visible text is a plain editor's", { timeout: 900_000 }, () => {
  const r = rng(20261111);
  let steps = 0;
  let done = 0;
  const refusals = new Map<string, number>();
  const wrong: string[] = [];
  for (let n = 0; n < NOTES; n++) {
    let text = genNote(r);
    for (let s = 0; s < STEPS; s++) {
      const o = oracleChars(text);
      const before = blocksOf(text, o);
      if (o.chars.length === 0) break;
      // Places in the source come from the editor's model; the checker only judges.
      const mc = buildModel(text).chars;
      if (mc.length !== o.chars.length || mc.some((c, i) => c.ch !== o.chars[i].ch)) {
        wrong.push(`the model and the checker disagree on the visible text of\n${text}`);
        break;
      }
      // A place: a block that is not code, and a visible index in it.
      const editable = [...new Set(o.chars.map((c) => c.block))].filter((b) => o.blocks[b] && !/code/.test(o.blocks[b].desc));
      if (editable.length === 0) break;
      const blk = editable[Math.floor(r() * editable.length)];
      const idx = o.chars.map((c, i) => (c.block === blk ? i : -1)).filter((i) => i >= 0);
      const va = idx[0];
      const vb = idx[idx.length - 1] + 1;
      const bi = before.findIndex((b) => b.chars[0] === o.chars[va]);
      const k = va + Math.floor(r() * (vb - va + 1));
      const pos = k > va ? mc[k - 1].end : mc[k].start;
      const local = k - va;
      const plain = before.map((b) => b.text);
      let expect: string[] = plain;
      let op = "";
      let res: Edit;
      const roll = r();
      if (roll < 0.45) {
        const ch = TYPED[Math.floor(r() * TYPED.length)];
        op = `type ${JSON.stringify(ch)}`;
        res = typeText(text, pos, pos, ch);
        expect = plain.map((t, i) => (i === bi ? t.slice(0, local) + ch + t.slice(local) : t));
      } else if (roll < 0.6 && k > va) {
        op = "backspace";
        res = deleteAt(text, pos, -1);
        expect = plain.map((t, i) => (i === bi ? t.slice(0, local - 1) + t.slice(local) : t));
      } else if (roll < 0.72 && k < vb) {
        op = "delete";
        res = deleteAt(text, pos, 1);
        expect = plain.map((t, i) => (i === bi ? t.slice(0, local) + t.slice(local + 1) : t));
      } else if (roll < 0.84 && vb - va > 1) {
        const a = va + Math.floor(r() * (vb - va));
        const z = a + 1 + Math.floor(r() * (vb - a));
        op = `select-delete ${a - va}..${z - va}`;
        res = deleteRange(text, mc[a].start, mc[z - 1].end);
        expect = plain.map((t, i) => (i === bi ? t.slice(0, a - va) + t.slice(z - va) : t));
      } else if (roll < 0.92) {
        const ins = Array.from({ length: 1 + Math.floor(r() * 4) }, () => TYPED[Math.floor(r() * TYPED.length)]).join("");
        op = `paste ${JSON.stringify(ins)}`;
        res = pastePlain(text, pos, pos, ins);
        expect = plain.map((t, i) => (i === bi ? t.slice(0, local) + ins + t.slice(local) : t));
      } else {
        if (k === va || k === vb || /cell|rule/.test(o.blocks[blk].desc)) continue;
        op = "enter";
        res = enter(text, pos, pos);
        expect = plain.flatMap((t, i) => (i === bi ? [t.slice(0, local), t.slice(local)] : [t]));
      }
      steps++;
      if (!res.ok) {
        refusals.set(res.reason, (refusals.get(res.reason) ?? 0) + 1);
        if (process.env.TYPE_GEN_SHOW && (refusals.get(res.reason) ?? 0) <= Number(process.env.TYPE_GEN_SHOW)) {
          console.log(`REFUSED ${op} at ${local} of ${JSON.stringify(plain[bi])}: ${res.reason}\n${text}\n`);
        }
        continue;
      }
      const after = blocksOf(res.text);
      const got = trimmed(after.map((b) => b.text));
      const want = trimmed(expect);
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        wrong.push(`${op} at ${local} of block ${bi}\n--- before\n${text}\n--- after\n${res.text}\n--- want ${JSON.stringify(want)}\n--- got  ${JSON.stringify(got)}`);
        break;
      }
      // Blocks not edited keep their look, character by character (Enter aside).
      if (op !== "enter" && after.length === before.length) {
        for (let i = 0; i < before.length; i++) {
          if (i === bi) continue;
          if (before[i].chars.map(lookKey).join() !== after[i].chars.map(lookKey).join()) {
            wrong.push(`${op}: block ${i} changed its look\n--- before\n${text}\n--- after\n${res.text}`);
            break;
          }
        }
      }
      done++;
      text = res.text;
    }
  }
  const rate = (100 * done) / steps;
  console.log(`typing generated: ${steps} steps, ${done} done (${rate.toFixed(2)}%), refusals: ${JSON.stringify(Object.fromEntries(refusals))}`);
  assert.deepEqual(wrong.slice(0, 3), []);
  assert.ok(rate > 95, `only ${rate.toFixed(1)}% done`);
});
