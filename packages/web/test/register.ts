// Lets Node's test runner load the stores, which are modules of Svelte runes (`*.svelte.ts`):
// their types are stripped and Svelte compiles them (server output: plain values, no DOM).

import { registerHooks, stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compileModule } from "svelte/compiler";

registerHooks({
  load(url, context, next) {
    if (!url.endsWith(".svelte.ts")) return next(url, context);
    const file = fileURLToPath(url);
    const js = stripTypeScriptTypes(readFileSync(file, "utf8"), { mode: "strip" });
    const out = compileModule(js, { filename: file.replace(/\.ts$/, ".js"), generate: "server", dev: false });
    return { format: "module", source: out.js.code, shortCircuit: true };
  },
});
