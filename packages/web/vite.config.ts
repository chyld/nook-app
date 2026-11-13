// Vite builds the browser bundle into packages/web/dist. Nothing is inlined as a data: URL.
// The CSS is split by chunk, so Excalidraw's CSS is its own file, requested with its script when
// a drawing is first opened (SPEC-DRAWINGS 3.1); a note loads neither. Excalidraw's fonts are
// copied to dist/assets/excalidraw/fonts/, where `window.EXCALIDRAW_ASSET_PATH` points it.
import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";

const excalidrawFonts = fileURLToPath(new URL("../../node_modules/@excalidraw/excalidraw/dist/prod/fonts", import.meta.url));

/** Copies Excalidraw's `fonts` folder into the bundle (SPEC-DRAWINGS 3.1). */
function copyExcalidrawFonts(): Plugin {
  return {
    name: "nook-excalidraw-fonts",
    apply: "build",
    writeBundle(options) {
      cpSync(excalidrawFonts, `${options.dir}/assets/excalidraw/fonts`, { recursive: true });
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/",
  plugins: [svelte({ compilerOptions: { css: "external" } }), copyExcalidrawFonts()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    cssCodeSplit: true,
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      // Radix modules (inside Excalidraw) start with "use client", which a bundle drops.
      onwarn(warning, warn) {
        if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
        warn(warning);
      },
    },
  },
  server: { fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] } },
});
