// SPEC2 10: the raw-colour rule for TypeScript in `web`. Colours of the app's own screens live in
// tokens.css; CodeMirror's theme and every component use var(--…). A note's own content is
// exempt: `palette.ts` holds the toolbar's twelve colours and twelve highlights.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../src", import.meta.url));
const EXEMPT = new Set(["palette.ts"]);
const RAW = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|oklch|oklab)\(|\b(?:linear|radial|conic)-gradient\(/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.ts$/.test(n) ? [p] : [];
  });
}

let bad = 0;
for (const file of walk(root)) {
  if (EXEMPT.has(path.basename(file))) continue;
  // Comments are not code: block comments are blanked (keeping their line breaks).
  const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  src.split("\n").forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "");
    if (RAW.test(code)) {
      bad++;
      console.error(`${path.relative(root, file)}:${i + 1}: a raw colour; use a token from styles/tokens.css`);
    }
  });
}
if (bad) process.exit(1);
console.log("raw colours: none outside tokens.css and palette.ts");
