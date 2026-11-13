<script lang="ts">
  // SPEC2 9.1, 6: the catalogue by name and category, as a dense grid that loads more as the
  // page is scrolled; add and remove fonts.
  // Each family is shown in its own typeface from a preview font of the letters of its name.
  import { fonts } from "../stores/fonts.svelte.ts";
  import { toasts } from "../stores/toasts.svelte.ts";
  import { previewUrl } from "../lib/api.ts";
  import { familyStyle, previewFaces } from "../lib/fontcss.ts";
  import Button from "../components/Button.svelte";

  let q = $state("");
  let category = $state("");
  let timer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    void fonts.browse("", "").catch((e) => toasts.push(e.message, "error"));
  });
  function search() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void browse(), 250);
  }
  /** A new search starts the loader again, also after a page of the old one failed. */
  function browse() {
    failed = false;
    return fonts.browse(q, category);
  }
  const mine = $derived(new Set(fonts.mine.map((f) => f.slug)));
  async function add(slug: string, family: string) {
    try {
      await fonts.add(slug);
      toasts.push(`${family} added. It is in the font list of every note.`, "info");
    } catch (e) {
      toasts.push(`Not added: ${e instanceof Error ? e.message : ""}`, "error");
    }
  }
  async function remove(slug: string) {
    try {
      await fonts.remove(slug);
    } catch (e) {
      toasts.push(`Not removed: ${e instanceof Error ? e.message : ""}`, "error");
    }
  }
  // More fonts are loaded whenever the end of the grid comes near the bottom of the window.
  let end = $state<HTMLElement | null>(null);
  let loading = $state(false);
  let failed = $state(false);
  const hasMore = $derived(fonts.families.length < fonts.total);
  $effect(() => {
    const el = end;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || loading || failed) return;
        loading = true;
        const search = `${fonts.q}\u0000${fonts.category}`;
        fonts
          .more()
          // A page that adds nothing to the same search would be asked for again and again: it
          // is shown as a failure, with Try again (review of alpha's changes, 13).
          .then((added) => {
            if (added === 0 && search === `${fonts.q}\u0000${fonts.category}` && hasMore) failed = true;
          })
          .catch(() => (failed = true))
          .finally(() => {
            loading = false;
            // Looked at again: a tall window may need several pages before it is full.
            io.unobserve(el);
            io.observe(el);
          });
      },
      { rootMargin: "1200px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  });
  // Try again: the loader's element is drawn again, and binds itself (review of alpha's
  // changes, 13: putting it back by hand left the loader with none).
  function retry() {
    failed = false;
  }

  /** A font face for each preview, loaded from the app (the browser never talks to Google). */
  const faces = $derived(previewFaces(fonts.families, previewUrl));
  // A style element with the page's nonce (the policy allows no other).
  $effect(() => {
    const el = document.createElement("style");
    el.nonce = document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content ?? "";
    el.textContent = faces;
    document.head.append(el);
    return () => el.remove();
  });
</script>

<section class="fonts">
  <div class="head">
    <h1>Fonts</h1>
    <div class="filters">
      <input class="input" type="search" placeholder="Search Google Fonts" aria-label="Search fonts" bind:value={q} oninput={search} />
      <select class="input" aria-label="Category" bind:value={category} onchange={() => browse()}>
        <option value="">All categories</option>
        {#each fonts.categories as c (c)}<option value={c}>{c}</option>{/each}
      </select>
    </div>
    {#if fonts.total}<span class="count">{fonts.families.length} of {fonts.total}</span>{/if}
  </div>
  {#if fonts.mine.length}
    <div class="mine" aria-label="Your fonts">
      {#each fonts.mine as f (f.slug)}
        <span class="chip" data-testid="font-row" data-slug={f.slug}>
          <span style={familyStyle(f.family)}>{f.family}</span>
          <button type="button" class="x" data-testid="font-remove" title={`Remove ${f.family}`} aria-label={`Remove ${f.family}`} disabled={fonts.busy === f.slug} onclick={() => remove(f.slug)}>×</button>
        </span>
      {/each}
    </div>
  {/if}
  {#if !fonts.available}
    <p class="empty">The list of Google Fonts could not be fetched. <Button small onclick={() => fonts.browse(q, category)}>Try again</Button></p>
  {/if}
  <div class="grid">
    {#each fonts.families as f (f.slug)}
      {@const has = mine.has(f.slug)}
      <div class="tile" class:has data-testid="font-row" data-slug={f.slug}>
        <span class="name" title={`${f.family} (${f.category})`} style={familyStyle(`preview-${f.slug}`)}>{f.family}</span>
        {#if has}
          <button type="button" class="act" data-testid="font-remove" title={`Remove ${f.family}`} aria-label={`Remove ${f.family}`} disabled={fonts.busy === f.slug} onclick={() => remove(f.slug)}>✓</button>
        {:else}
          <button type="button" class="act" data-testid="font-add" title={`Add ${f.family}`} aria-label={`Add ${f.family}`} disabled={fonts.busy === f.slug} onclick={() => add(f.slug, f.family)}>{fonts.busy === f.slug ? "…" : "+"}</button>
        {/if}
      </div>
    {/each}
  </div>
  {#if failed}
    <p class="empty">More fonts could not be loaded. <Button small onclick={retry}>Try again</Button></p>
  {:else if hasMore}
    <div class="end" bind:this={end} aria-hidden="true">Loading more fonts…</div>
  {/if}
</section>

<style>
  .fonts {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2) var(--s-4);
  }
  h1 {
    font-family: var(--font-display);
    font-size: var(--text-xl);
  }
  .filters {
    display: flex;
    gap: var(--s-2);
    flex: 1;
    min-width: 16rem;
    max-width: 36rem;
  }
  .input {
    min-height: 2rem;
    padding: 0 var(--s-3);
    border: 1px solid var(--rule);
    border-radius: var(--r-md);
    background: var(--surface);
    flex: 1;
    min-width: 8rem;
  }
  /* A phone: the search row takes the whole width and its boxes shrink with it (review of alpha's
     changes, 18). */
  @media (max-width: 640px) {
    .filters {
      flex-basis: 100%;
      min-width: 0;
    }
    .input {
      min-width: 0;
    }
  }
  .mine {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    padding: 0 var(--s-1) 0 var(--s-3);
    border-radius: var(--r-pill);
    background: var(--accent-soft);
    color: var(--accent-strong);
    font-size: var(--text-md);
  }
  .x {
    width: 1.5rem;
    height: 1.5rem;
    border: 0;
    border-radius: var(--r-pill);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .x:hover {
    background: var(--surface);
  }
  /* As many columns as fit; a tile is one line: the name in its own typeface and one button. */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11.5rem, 1fr));
    gap: var(--s-1);
  }
  .tile {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    min-width: 0;
    padding: var(--s-0) var(--s-1) var(--s-0) var(--s-2);
    border: 1px solid var(--rule);
    border-radius: var(--r-sm);
    background: var(--surface);
  }
  .tile:hover {
    border-color: var(--accent);
  }
  .tile.has {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .name {
    flex: 1;
    min-width: 0;
    font-size: var(--text-lg);
    line-height: 2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .act {
    flex: none;
    width: 1.5rem;
    height: 1.5rem;
    border: 0;
    border-radius: var(--r-pill);
    background: var(--surface-2);
    color: var(--ink-soft);
    font-weight: 700;
    cursor: pointer;
  }
  .tile:hover .act,
  .tile.has .act {
    background: var(--accent);
    color: var(--accent-ink);
  }
  .act:disabled,
  .x:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .count,
  .empty,
  .end {
    color: var(--ink-soft);
    font-size: var(--text-sm);
  }
  .end {
    padding: var(--s-4) 0;
    text-align: center;
  }
</style>
