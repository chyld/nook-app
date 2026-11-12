// Finding 38 of the version 2 code review: typing over a selection (`typeOver`, the one routine
// version 2 changed, SPEC-NOTES "a bug in version 1's typeText") on generated notes. A selection
// of text inside one block, typed over: the visible text is the old one with the selection
// replaced, every other character keeps its look and its block, and the typed characters take
// the look of the first selected one. A refusal changes nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/index.ts";
import { typeText } from "../src/style/typing.ts";
import { genNote, rng } from "./gen.ts";

type Ch = ReturnType<typeof buildModel>["chars"][number];
/** A character's look as a person sees it: bold and italic do not show on a space; a link is
 *  left out (typing next to a bare address can move where the address ends). */
const look = (c: Ch, noCode = false) => {
  const s = { ...c.style, link: null, ...(noCode ? { code: false } : {}) } as Record<string, unknown>;
  if (/\s/.test(c.ch)) s.bold = s.italic = false;
  return JSON.stringify([c.kind, s]);
};

const INS = ["x", "ab", "*", "é", "#", "_", "1.", "[", "`", "日本"];

test("38: typing over a selection inside a block, on generated notes", () => {
  const r = rng(38);
  let checked = 0;
  let refusedCount = 0;
  for (let n = 0; n < 3000; n++) {
    const text = genNote(r);
    const m = buildModel(text);
    const blocks = [...new Set(m.chars.map((c) => c.block))].filter((b) => !["code", "cell"].includes(m.blocks[b].info.kind));
    if (!blocks.length) continue;
    const b = blocks[Math.floor(r() * blocks.length)];
    const idx = m.chars.flatMap((c, k) => (c.block === b && c.kind === "text" ? [k] : []));
    if (idx.length < 2) continue;
    const i = idx[Math.floor(r() * (idx.length - 1))];
    let j = i + 1 + Math.floor(r() * Math.min(6, idx.length));
    while (j > i + 1 && !(j - 1 < m.chars.length && m.chars[j - 1].block === b && m.chars[j - 1].kind === "text")) j--;
    if (m.chars.slice(i, j).some((c) => c.kind !== "text" || c.block !== b)) continue;
    const ins = INS[Math.floor(r() * INS.length)];
    const from = m.chars[i].start;
    const to = m.chars[j - 1].end;
    const label = `${JSON.stringify(ins)} over [${from}, ${to}) of ${JSON.stringify(text)}`;
    const e = typeText(text, from, to, ins);
    const res = e.ok ? { ok: true as const, doc: { text: e.text }, differs: !!e.styleDiffers } : { ok: false as const };
    if (!res.ok) {
      refusedCount++;
      continue;
    }
    checked++;
    const nm = buildModel(res.doc.text);
    const old = m.chars.map((c) => c.ch);
    const d = [...ins].length;
    assert.equal(nm.chars.map((c) => c.ch).join(""), old.slice(0, i).join("") + ins + old.slice(j).join(""), `visible text: ${label} gave ${JSON.stringify(res.doc.text)}`);
    const at = (x: number) => (x < i ? x : x - (j - i) + d);
    for (let x = 0; x < m.chars.length; x++) {
      if (x >= i && x < j) continue;
      assert.equal(look(nm.chars[at(x)]), look(m.chars[x]), `the look of ${JSON.stringify(m.chars[x].ch)} (${x}): ${label} gave ${JSON.stringify(res.doc.text)}`);
    }
    const kept = [...m.chars.keys()].filter((x) => x < i || x >= j);
    for (let k = 0; k + 1 < kept.length; k++) {
      const [x, y] = [kept[k], kept[k + 1]];
      assert.equal(nm.chars[at(x)].block === nm.chars[at(y)].block, m.chars[x].block === m.chars[y].block, `blocks: ${label}`);
    }
    // The typed text takes the look of the first selected character (typeOver); when replacing
    // in place does not pass its checks, the selection is deleted and the text typed, and it
    // takes the look of the character before it, or after it at the block's start (7.5).
    // (Where a neighbour's look cannot hold the typed text, a backtick next to code, the other
    // neighbour's is taken.)
    // Typing does not make code: typed text may stand outside inline code that the selection
    // started in (and a backtick cannot be code itself), so the code mark of the typed text is
    // not compared. Every other part of its look is.
    const nc = true;
    const beside = [i - 1, j].filter((x) => x >= 0 && x < m.chars.length && m.chars[x].block === b).map((x) => look(m.chars[x], nc));
    const allowed = new Set([look(m.chars[i], nc), ...beside]);
    // When the routine says the typed text could not be given exactly the look it wanted
    // (`styleDiffers`, version 1's rule), only the rest is checked.
    if (res.differs) continue;
    const typed = new Set(nm.chars.slice(i, i + d).map((c) => look(c, nc)));
    assert.equal(typed.size, 1, `the typed characters have one look: ${label} gave ${JSON.stringify(res.doc.text)}`);
    assert.ok(allowed.has([...typed][0]), `the typed text's look ${[...typed][0]} is neither the first selected character's nor a neighbour's: ${label} gave ${JSON.stringify(res.doc.text)}`);
  }
  console.log(`typeover: ${checked} checked, ${refusedCount} refused`);
  assert.ok(checked > 1000, `only ${checked} were checked`);
});
