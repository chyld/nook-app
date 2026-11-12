// Vite builds the browser bundle into packages/web/dist. Nothing is inlined as a data: URL,
// because the content security policy allows images and fonts only from the app itself.
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/",
  plugins: [svelte({ compilerOptions: { css: "external" } })],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
  server: { fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] } },
});
