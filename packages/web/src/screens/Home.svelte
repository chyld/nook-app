<script lang="ts">
  // SPEC2 9.1, 9.5: the welcome, and any drafts found. For a note that is gone a draft offers
  // "Save as a new note" or discard.
  import { drafts } from "../stores/drafts.svelte.ts";
  import { editor, itemPath } from "../stores/editor.svelte.ts";
  import { library } from "../stores/library.svelte.ts";
  import { session } from "../stores/session.svelte.ts";
  import { router } from "../lib/router.svelte.ts";
  import { clock } from "../lib/format.ts";
  import Button from "../components/Button.svelte";
  import Icon from "../components/Icon.svelte";

  let { ontoggle, sidebarShown }: { ontoggle: () => void; sidebarShown: boolean } = $props();
  const found = $derived.by(() => {
    void drafts.version;
    return session.user ? drafts.list(session.user.id) : [];
  });
  // A note missing from a list narrowed by a search or a tag is looked up, not taken as gone.
  $effect(() => {
    for (const d of found) if (library.noteStatus(d.noteId) === "unknown") void library.lookup(d.noteId);
  });
  const noun = (d: (typeof found)[number]) => (d.kind === "drawing" ? "drawing" : "note");
  const titleOf = (d: (typeof found)[number]) => library.titleOf(d.noteId) ?? (library.noteStatus(d.noteId) === "gone" ? `A ${noun(d)} that is gone` : `A ${noun(d)}`);

  async function saveAsNew(d: (typeof found)[number]) {
    // A drawing's draft goes with ?from=<id>: the server fills in its images (SPEC-DRAWINGS 4.5).
    const id = await editor.saveAsNew(d.text, d.noteId, d.kind);
    if (id) {
      drafts.remove(d.key);
      await router.go(itemPath(d.kind, id));
    }
  }
</script>

<div class="home">
  {#if !sidebarShown}
    <div class="top"><Button variant="icon" data-testid="notes-button" aria-label="Show the notes" onclick={ontoggle}><Icon name="menu" /></Button></div>
  {/if}
  <section class="welcome">
    <h1>Pick a note, or start a new one</h1>
    <p>Your notes are on the left. New note makes one; search and tags narrow the list.</p>
  </section>
  {#if found.length}
    <section class="drafts">
      <h2>Unsaved text found</h2>
      {#each found as d (d.key)}
        <div class="draft" data-testid="draft-row" data-id={d.noteId}>
          <div class="what">
            <span class="name">{titleOf(d)}</span>
            <span class="time">Unsaved text from {clock(d.time)}</span>
          </div>
          {#if library.noteStatus(d.noteId) !== "gone"}
            <Button small variant="primary" data-testid="draft-open" onclick={() => router.go(itemPath(d.kind, d.noteId))}>Open</Button>
          {:else}
            <Button small variant="primary" data-testid="save-as-new" onclick={() => saveAsNew(d)}>Save as a new {noun(d)}</Button>
          {/if}
          <Button small data-testid="draft-discard" onclick={() => drafts.remove(d.key)}>Discard</Button>
        </div>
      {/each}
    </section>
  {/if}
</div>

<style>
  .home {
    height: 100%;
    overflow-y: auto;
    padding: var(--s-4);
  }
  .welcome {
    max-width: 32rem;
    margin: var(--s-8) auto var(--s-5);
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  h1 {
    font-family: var(--font-display);
    font-size: var(--text-2xl);
    letter-spacing: -0.015em;
  }
  .welcome p {
    color: var(--ink-soft);
  }
  .drafts {
    max-width: 36rem;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  h2 {
    font-size: var(--text-md);
  }
  .draft {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-3);
    border: 1px solid var(--rule);
    border-radius: var(--r-md);
    flex-wrap: wrap;
  }
  .what {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 10rem;
  }
  .name {
    font-weight: 600;
  }
  .time {
    font-size: var(--text-sm);
    color: var(--ink-soft);
  }
</style>
