<script lang="ts">
  // SPEC-DRAWINGS 4.4: a drawing's earlier versions, newest first. A version is shown in
  // Excalidraw in view mode and restored by saving its text against the current revision; every
  // version is a whole file, so every version can be restored.
  import { onMount } from "svelte";
  import { sceneOf } from "../../../core/src/index.ts";
  import { ApiError } from "../lib/api.ts";
  import { router } from "../lib/router.svelte.ts";
  import { library } from "../stores/library.svelte.ts";
  import { toasts } from "../stores/toasts.svelte.ts";
  import Button from "../components/Button.svelte";
  import type { DrawingHandle } from "../drawing/mount.ts";

  let { id }: { id: string } = $props();
  const picked = $derived(library.versionsOf === id ? library.picked : null);
  const text = $derived(picked ? library.pickedText : null);
  const scene = $derived(text === null ? null : sceneOf(text));
  let host = $state<HTMLElement | null>(null);
  let handle: DrawingHandle | null = null;
  /** The version Excalidraw shows now (review, 4): Restore waits until it is the one picked. */
  let shown = $state<string | null>(null);
  let busy = false;
  let failed = $state(false);
  let gone = false;
  const ready = $derived(picked !== null && shown === picked && scene !== null);

  onMount(() => {
    void (async () => {
      // A note's id: its own history screen (SPEC-DRAWINGS 6).
      if (!library.loaded) await library.refresh();
      if (library.kindOf(id) === null) await library.lookup(id);
      if (library.kindOf(id) === "note") {
        void router.go(`/n/${id}/history`, { replace: true, force: true });
        return;
      }
      await library.loadHistory(id).catch((e) => toasts.push(e.message, "error"));
    })();
    return () => {
      gone = true;
      handle?.unmount();
      handle = null;
    };
  });

  function pick(v: string) {
    void library.pickVersion(id, v).catch((e) => toasts.push(`This version could not be read: ${e instanceof Error ? e.message : ""}`, "error"));
  }

  /** Shows the version picked last: one loop, so a pick made while Excalidraw is still loading
   *  is shown once it has loaded, and never another one (review, 4). */
  async function sync() {
    if (busy) return;
    busy = true;
    try {
      while (!gone && host && picked !== null && scene !== null && shown !== picked) {
        const v = picked;
        const sc = scene;
        shown = null;
        if (!handle) {
          (window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = "/assets/excalidraw/";
          const m = await import("../drawing/mount.ts");
          if (gone || !host) return;
          const dark = typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
          handle = m.mountDrawing(host, { scene: sc, viewMode: true, theme: dark ? "dark" : "light", libraryKey: null, libraryReturnUrl: `${location.origin}/d/${id}`, onFailed: () => (failed = true) });
          await handle.ready;
        } else await handle.load(sc);
        if (!gone) shown = v;
      }
    } catch {
      failed = true;
    } finally {
      busy = false;
    }
  }
  $effect(() => {
    void picked;
    void scene;
    if (host) void sync();
  });
  function retry() {
    failed = false;
    handle?.unmount();
    handle = null;
    shown = null;
    void sync();
  }

  async function restore() {
    if (!picked || text === null || !ready) return;
    try {
      await library.restoreVersion(id, text, "drawing");
      toasts.push("Restored. The drawing before is now in the history too.", "info");
      await router.go(`/d/${id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) toasts.push("The drawing changed meanwhile. Try again.", "warn");
      else toasts.push(`Not restored: ${e instanceof Error ? e.message : ""}`, "error");
    }
  }
</script>

<section class="history">
  <div class="head">
    <h1>Earlier versions</h1>
    <a href={`/d/${id}`} onclick={(e) => (e.preventDefault(), router.go(`/d/${id}`))}>Back to the drawing</a>
  </div>
  {#if library.versionsOf === id && library.versions.length === 0}<p class="empty">No earlier versions yet. Each save keeps the drawing from before it (the newest 20).</p>{/if}
  <div class="cols">
    <div class="list">
      {#each library.versions as v (v.version)}
        <button type="button" class="row" class:on={picked === v.version} data-testid="history-row" data-version={v.version} data-agent={v.agent ?? undefined} onclick={() => pick(v.version)}>
          <span>{new Date(v.time).toLocaleString()}</span>
          <span class="size">{v.size} bytes{#if v.agent} · written by {v.agent}{/if}</span>
        </button>
      {/each}
    </div>
    <!-- Always in the page, so Excalidraw is never left mounted on a removed element (review, 4). -->
    <div class="view" class:hidden={!picked}>
      {#if picked}
        <div class="tools">
          <Button small variant="primary" data-testid="history-restore" disabled={!ready} onclick={restore}>Restore this version</Button>
          {#if text !== null && scene === null}<span class="warn">This version is not an Excalidraw scene and cannot be shown or restored.</span>{/if}
          {#if failed}<span class="warn">The drawing editor could not be loaded.</span> <Button small data-testid="drawing-retry" onclick={retry}>Try again</Button>{/if}
        </div>
      {/if}
      <div class="canvas excalidraw-host" data-testid="drawing" data-ready={ready ? "true" : "false"} data-shown={shown ?? ""} bind:this={host}></div>
    </div>
  </div>
</section>

<style>
  .history {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s-3);
    flex-wrap: wrap;
  }
  h1 {
    font-family: var(--font-display);
    font-size: var(--text-2xl);
  }
  .cols {
    display: grid;
    grid-template-columns: minmax(12rem, 16rem) 1fr;
    gap: var(--s-4);
  }
  @media (max-width: 640px) {
    .cols {
      grid-template-columns: 1fr;
    }
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: var(--s-0);
    padding: var(--s-2) var(--s-3);
    border: 1px solid var(--rule);
    border-radius: var(--r-md);
    background: var(--surface);
    text-align: left;
    cursor: pointer;
  }
  .row.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .size {
    font-size: var(--text-xs);
    color: var(--ink-soft);
  }
  .tools {
    display: flex;
    gap: var(--s-2);
    flex-wrap: wrap;
    align-items: center;
    margin-bottom: var(--s-3);
  }
  .canvas {
    height: 70vh;
    border: 1px solid var(--rule);
    border-radius: var(--r-md);
    overflow: hidden;
  }
  .hidden {
    display: none;
  }
  .warn {
    color: var(--warn-ink);
    font-size: var(--text-sm);
  }
  .empty {
    color: var(--ink-soft);
  }
</style>
