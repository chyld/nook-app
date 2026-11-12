// Generated notes for the generated tests (EDITOR-PLAN 8): a seeded random generator and a
// note maker that mixes every kind of inline markup and block.

/** A small seeded random number generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ["alpha", "beta", "gamma", "delta", "x", "Saudade", "3]", "{name}", "a*b", "C++", "snake_case", "100%", "é", "日本", "two words", "!", "end."];
const COLOURS = ["red", "blue", "teal", "#c2410c", "gray"];
const SIZES = ["small", "large", "xl", "22px", "14pt", "10.5pt"];

export function genNote(r: () => number): string {
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  const attrList = () => {
    const parts: string[] = [];
    if (r() < 0.6) parts.push(`color=${pick(COLOURS)}`);
    if (r() < 0.3) parts.push(`size=${pick(SIZES)}`);
    if (r() < 0.2) parts.push(`bg=${pick(["mint", "highlight", "red"])}`);
    if (r() < 0.15) parts.push(`underline=${pick(["yes", "no"])}`);
    if (r() < 0.15) parts.push(pick(['font="IBM Plex Serif"', "font=serif", "font=Caveat"]));
    if (parts.length === 0) parts.push("color=red");
    return `{${parts.join(" ")}}`;
  };
  const inline = (depth: number, spanOk: boolean): string => {
    const k = r();
    const w = pick(WORDS);
    if (depth > 2 || k < 0.35) return w;
    if (k < 0.45) return `**${inline(depth + 1, spanOk)}**`;
    if (k < 0.52) return `*${inline(depth + 1, spanOk)}*`;
    if (k < 0.56) return `~~${inline(depth + 1, spanOk)}~~`;
    if (k < 0.61) return `++${inline(depth + 1, false)}++`;
    if (k < 0.65) return `==${inline(depth + 1, false)}==`;
    if (k < 0.77 && spanOk) return `[${inline(depth + 1, false)} ${pick(WORDS)}]${attrList()}`;
    if (k < 0.83) return `[${pick(WORDS)} ${pick(["page", "site"])}](https://ex.example/${pick(["a", "b_c", "d"])})`;
    if (k < 0.87) return `https://site.example/${pick(["path", "a_b", "x"])}`;
    if (k < 0.92) return "`" + pick(["code", "a b", "x*y"]) + "`";
    if (k < 0.95) return "\\*";
    return "&amp;";
  };
  const para = () => {
    const n = 2 + Math.floor(r() * 5);
    const items: string[] = [];
    for (let i = 0; i < n; i++) items.push(inline(0, true));
    let t = items.join(" ");
    if (r() < 0.15) t += (r() < 0.5 ? "\n" : "  \n") + inline(0, true) + " " + pick(WORDS);
    return t;
  };
  const blocks: string[] = [];
  if (r() < 0.2) blocks.push(`---\n${r() < 0.5 ? "size: 14pt" : "font: Caveat"}\n---`);
  const nb = 1 + Math.floor(r() * 3);
  for (let i = 0; i < nb; i++) {
    const k = r();
    let blk: string;
    if (k < 0.45) blk = para();
    else if (k < 0.6) blk = `${"#".repeat(1 + Math.floor(r() * 3))} ${para()}`.split("\n")[0];
    else if (k < 0.75) blk = `- ${para().split("\n")[0]}\n- ${para().split("\n")[0]}`;
    else if (k < 0.85) blk = `> ${para().split("\n")[0]}`;
    else if (k < 0.9) blk = "```\ncode **not bold**\n```";
    else blk = para();
    if ((k < 0.6 || k >= 0.9) && r() < 0.25 && !blk.startsWith("```")) blk += `\n${attrList()}`;
    blocks.push(blk);
  }
  return blocks.join("\n\n") + (r() < 0.5 ? "\n" : "");
}
