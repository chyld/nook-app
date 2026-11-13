<script lang="ts">
  // SPEC2 4.6, 9.1: earlier versions, newest first; a version can be viewed rendered or raw, and
  // restored. A restore is an ordinary save, so it can itself be undone. A version with broken
  // front matter can be viewed and copied but not restored.
  import { ApiError, assetUrl } from "../lib/api.ts";
  import { renderInto } from "../lib/render.ts";
  import { router } from "../lib/router.svelte.ts";
  import { hasBrokenFrontMatter } from "../../../core/src/index.ts";
  import { library } from "../stores/library.svelte.ts";
  import { toasts } from "../stores/toasts.svelte.ts";
  import Button from "../components/Button.svelte";

  let { id }: { id: string } = $props();
  const picked = $derived(library.versionsOf === id ? library.picked : null);
  /** The picked version's text; null until it has been read, and Restore waits for it. */
  const text = $derived(picked ? library.pickedText : null);
  let raw = $state(false);
  let article = $state<HTMLElement | null>(null);

  $effect(() => {
    void library.loadHistory(id).catch((e) => toasts.push(e.message, "error"));
  });
  // A drawing's id: its own history screen (SPEC-DRAWINGS 6). The kind comes from the list.
  $effect(() => {
    if (!library.loaded) void library.refresh();
  });
  $effect(() => {
    if (library.kindOf(id) === "drawing") void router.go(`/d/${id}/history`, { replace: true, force: true });
  });
  function pick(v: string) {
    void library.pickVersion(id, v).catch((e) => toasts.push(`This version could not be read: ${e instanceof Error ? e.message : ""}`, "error"));
  }
  $effect(() => {
    if (!raw && article && picked && text !== null) renderInto(article, text, (f) => assetUrl(id, f));
  });
  const broken = $derived(text !== null && hasBrokenFrontMatter(text));
  async function restore() {
    if (!picked || text === null) return;
    try {
      await library.restoreVersion(id, text);
      toasts.push("Restored. The text before is now in the history too.", "info");
      await router.go(`/n/${id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) toasts.push("The note changed meanwhile. Try again.", "warn");
      else toasts.push(`Not restored: ${e instanceof Error ? e.message : ""}`, "error");
    }
  }
</script>

<section class="history">
  <div class="head">
    <h1>Earlier versions</h1>
    <a href={`/n/${id}`} onclick={(e) => (e.preventDefault(), router.go(`/n/${id}`))}>Back to the note</a>
  </div>
  {#if library.versionsOf === id && library.versions.length === 0}<p class="empty">No earlier versions yet. Each save keeps the text from before it.</p>{/if}
  <div class="cols">
    <div class="list">
      {#each library.versions as v (v.version)}
        <button type="button" class="row" class:on={picked === v.version} data-testid="history-row" data-version={v.version} onclick={() => pick(v.version)}>
          <span>{new Date(v.time).toLocaleString()}</span>
          <span class="size">{v.size} bytes</span>
        </button>
      {/each}
    </div>
    {#if picked}
      <div class="view">
        <div class="tools">
          <Button small pressed={!raw} onclick={() => (raw = false)}>Rendered</Button>
          <Button small pressed={raw} onclick={() => (raw = true)}>Raw</Button>
          <Button small variant="primary" data-testid="history-restore" disabled={broken || text === null} title={broken ? "Its front matter does not parse; copy the text instead" : ""} onclick={restore}>Restore this version</Button>
        </div>
        {#if raw}
          <pre class="raw">{text ?? ""}</pre>
        {:else}
          <article class="note" bind:this={article}></article>
        {/if}
      </div>
    {/if}
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
    margin-bottom: var(--s-3);
  }
  .raw {
    white-space: pre-wrap;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    padding: var(--s-3);
    border: 1px solid var(--rule);
    border-radius: var(--r-md);
    overflow-x: auto;
  }
  .empty {
    color: var(--ink-soft);
  }
</style>
