<script lang="ts">
  // SPEC2 9.1, 4.3: trashed notes: read, restore, empty one or all. Emptying is the only action
  // that destroys data, and it asks for confirmation. A drawing's row says it is a drawing and
  // has no reader (SPEC-DRAWINGS 6).
  import Icon from "../components/Icon.svelte";
  import { assetUrl } from "../lib/api.ts";
  import { renderInto } from "../lib/render.ts";
  import { library } from "../stores/library.svelte.ts";
  import { toasts } from "../stores/toasts.svelte.ts";
  import Button from "../components/Button.svelte";

  let reading = $state<string | null>(null);
  let article = $state<HTMLElement | null>(null);

  $effect(() => {
    void library.loadTrash().catch((e) => toasts.push(e.message, "error"));
  });
  $effect(() => {
    const id = reading;
    const el = article;
    if (!id || !el) return;
    void library.readTrashed(id).then(
      (text) => renderInto(el, text, (f) => assetUrl(id, f, true)),
      (e) => toasts.push(`This note cannot be shown: ${e instanceof Error ? e.message : ""}`, "error"),
    );
  });
  async function restore(id: string) {
    try {
      await library.restore(id);
      toasts.push("Restored.", "info");
      if (reading === id) reading = null;
    } catch (e) {
      toasts.push(`Not restored: ${e instanceof Error ? e.message : ""}`, "error");
    }
  }
  async function empty(ids: string[], what: string) {
    if (!(await toasts.confirm(`Delete ${what} for good? This cannot be undone.`, { ok: "Delete for good", danger: true }))) return;
    await library.empty(ids);
    if (reading && ids.includes(reading)) reading = null;
  }
</script>

<section class="trash">
  <div class="head">
    <h1>Trash</h1>
    {#if library.trashed.length}<Button variant="danger" data-testid="trash-empty-all" onclick={() => empty(library.trashed.map((e) => e.id), library.trashed.length === 1 ? "the note in the trash" : `all ${library.trashed.length} notes in the trash`)}>Empty the trash</Button>{/if}
  </div>
  {#if library.trashLoaded && library.trashed.length === 0}<p class="empty">The trash is empty.</p>{/if}
  <div class="rows">
    {#each library.trashed as e (e.id)}
      <div class="row" data-testid="trash-row" data-id={e.id} data-kind={e.kind}>
        {#if e.kind === "drawing"}
          <span class="name"><span class="kind"><Icon name="pen" size={14} /> Drawing</span> {e.title}</span>
        {:else}
          <button type="button" class="name" onclick={() => (reading = reading === e.id ? null : e.id)}>{e.title}</button>
        {/if}
        <span class="when">{e.trashed ? new Date(e.trashed).toLocaleString() : ""}</span>
        <Button small data-testid="trash-restore" onclick={() => restore(e.id)}>Restore</Button>
        <Button small variant="quiet" data-testid="trash-empty-one" onclick={() => empty([e.id], `"${e.title}"`)}>Delete</Button>
      </div>
      {#if reading === e.id}
        <article class="note reader" bind:this={article}></article>
      {/if}
    {/each}
  </div>
</section>

<style>
  .trash {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
    flex-wrap: wrap;
  }
  h1 {
    font-family: var(--font-display);
    font-size: var(--text-2xl);
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
    border: 1px solid var(--rule);
    border-radius: var(--r-md);
    flex-wrap: wrap;
  }
  .name {
    flex: 1;
    min-width: 8rem;
    border: 0;
    background: transparent;
    text-align: left;
    font-weight: 600;
    cursor: pointer;
  }
  .kind {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    margin-right: var(--s-1);
    font-size: var(--text-xs);
    font-weight: 400;
    color: var(--ink-soft);
  }
  .when {
    font-size: var(--text-sm);
    color: var(--ink-soft);
  }
  .reader {
    padding: var(--s-4);
    border: 1px solid var(--rule);
    border-radius: var(--r-md);
    background: var(--surface);
  }
  .empty {
    color: var(--ink-soft);
  }
</style>
