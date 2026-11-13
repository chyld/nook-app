<script lang="ts">
  import Logo from "../components/Logo.svelte";
  // SPEC2 9.3: the brand, a fold button, New note, a search box, tag chips with counts ("All"
  // first), the list of notes, and links to Trash, Fonts, Styles and Account.
  import { library } from "../stores/library.svelte.ts";
  import { prefs } from "../stores/prefs.svelte.ts";
  import { toasts } from "../stores/toasts.svelte.ts";
  import { router } from "../lib/router.svelte.ts";
  import { itemPath } from "../stores/editor.svelte.ts";
  import type { Kind } from "../../../contract/src/index.ts";
  import { tagHue, when } from "../lib/format.ts";
  import Icon from "../components/Icon.svelte";
  import Chip from "../components/Chip.svelte";
  import Button from "../components/Button.svelte";

  let { openId = null, onfold }: { openId?: string | null; onfold: () => void } = $props();

  $effect(() => {
    if (!library.loaded) void library.refresh();
  });

  async function newItem(kind: Kind) {
    // Asked first, so cancelling leaves no empty item behind (review, 08-6).
    if (!(await router.mayLeave())) return;
    try {
      const id = await library.create(undefined, kind);
      prefs.setSheet(false);
      await router.go(itemPath(kind, id), { force: true });
    } catch (e) {
      toasts.push(`The ${kind} could not be made: ${e instanceof Error ? e.message : ""}`, "error");
    }
  }
  async function pick(kind: Kind, id: string, e: Event) {
    e.preventDefault();
    if (await router.go(itemPath(kind, id))) prefs.setSheet(false);
  }
  const links: [string, string, string, string][] = [
    ["/trash", "Trash", "trash", "nav-trash"],
    ["/fonts", "Fonts", "font", "nav-fonts"],
    ["/styles", "Styles", "styles", "nav-styles"],
    ["/account", "Account", "user", "nav-account"],
  ];
</script>

<aside class="sidebar" data-testid="sidebar" aria-label="Notes">
  <div class="head">
    <a class="brand" href="/" onclick={(e) => (e.preventDefault(), router.go("/"))}><Logo size={30} /><span>Nook</span></a>
    <Button variant="icon" data-testid="sidebar-fold" aria-label="Fold the sidebar" title="Fold the sidebar" onclick={onfold}><Icon name="fold" /></Button>
  </div>
  <div class="new">
    <Button variant="primary" data-testid="new-note" onclick={() => newItem("note")}><Icon name="plus" size={16} /> New note</Button>
    <Button data-testid="new-drawing" onclick={() => newItem("drawing")}><Icon name="pen" size={16} /> New drawing</Button>
  </div>
  <label class="search">
    <Icon name="search" size={16} />
    <input type="search" placeholder="Search" aria-label="Search notes" data-testid="search" value={library.search} oninput={(e) => library.setSearch((e.target as HTMLInputElement).value)} />
  </label>
  {#if library.tags.length}
    <div class="tags">
      <button type="button" class="tagbtn" data-testid="tag-chip" data-tag="" onclick={() => library.setTag("")}><Chip hue={0} active={library.tag === ""}>All</Chip></button>
      {#each library.tags as t (t.tag)}
        <button type="button" class="tagbtn" data-testid="tag-chip" data-tag={t.tag} onclick={() => library.setTag(t.tag)}><Chip hue={tagHue(t.tag)} active={library.tag === t.tag}>{t.tag} <span class="count">{t.count}</span></Chip></button>
      {/each}
    </div>
  {/if}
  <nav class="list" aria-label="Your notes">
    {#each library.entries as e (e.id)}
      <a class="row" class:open={e.id === openId} href={itemPath(e.kind, e.id)} data-testid="note-row" data-id={e.id} data-kind={e.kind} aria-current={e.id === openId ? "page" : undefined} onclick={(ev) => pick(e.kind, e.id, ev)}>
        <span class="title">{#if e.kind === "drawing"}<span class="pen" title="A drawing"><Icon name="pen" size={14} label="Drawing" /></span>{/if}{e.title}</span>
        <span class="meta">
          <span class="time">{when(e.modified)}</span>
          {#if e.problem}<span class="warn" title={e.problem === "broken" ? "The front matter does not parse" : "Cannot be opened"}><Icon name="warn" size={14} /></span>{/if}
          {#each e.tags.slice(0, 3) as t (t)}<Chip hue={tagHue(t)}>{t}</Chip>{/each}
        </span>
        {#if e.excerpt}<span class="excerpt">{e.excerpt}</span>{/if}
      </a>
    {:else}
      {#if library.error}
        <p class="empty">The notes could not be listed. <Button small onclick={() => library.refresh()}>Try again</Button></p>
      {:else}
        <p class="empty">{library.loaded ? (library.search || library.tag ? "Nothing matches." : "No notes yet.") : ""}</p>
      {/if}
    {/each}
  </nav>
  <nav class="foot" aria-label="Places">
    {#each links as [href, label, icon, id] (href)}
      <a {href} data-testid={id} onclick={(e) => (e.preventDefault(), router.go(href))}><Icon name={icon} size={16} /><span>{label}</span></a>
    {/each}
  </nav>
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    height: 100%;
    padding: var(--s-3) var(--s-3) var(--s-2);
    border-right: 1px solid var(--rule);
    background: var(--side-bg);
    overflow: hidden;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    color: var(--ink);
    text-decoration: none;
    font-family: var(--font-display);
    font-weight: 750;
    font-size: var(--text-lg);
  }
  .new {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--s-2);
  }
  .pen {
    display: inline-block;
    vertical-align: -0.125em;
    margin-right: var(--s-1);
    color: var(--c-sky);
  }
  .search {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: 0 var(--s-3);
    border: 1px solid var(--rule);
    border-radius: var(--r-md);
    background: var(--side-card);
    color: var(--ink-soft);
  }
  .search input {
    flex: 1;
    min-width: 0;
    min-height: 2.25rem;
    border: 0;
    background: transparent;
    outline: none;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1);
  }
  .tagbtn {
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
  }
  .count {
    opacity: 0.7;
  }
  .list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    scrollbar-width: none;
  }
  .list::-webkit-scrollbar {
    display: none;
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-md);
    color: var(--ink);
    text-decoration: none;
  }
  .row:hover {
    background: var(--side-hover);
  }
  .row.open {
    background: var(--side-card);
    box-shadow: var(--shadow-1);
  }
  .title {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    flex-wrap: wrap;
    font-size: var(--text-xs);
    color: var(--ink-soft);
  }
  .warn {
    color: var(--c-orange);
  }
  .excerpt {
    font-size: var(--text-xs);
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty {
    padding: var(--s-3);
    color: var(--ink-soft);
    font-size: var(--text-sm);
  }
  .foot {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--s-1);
    padding-top: var(--s-2);
    border-top: 1px solid var(--rule);
  }
  .foot a {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-0);
    padding: var(--s-1);
    border-radius: var(--r-sm);
    color: var(--ink-soft);
    text-decoration: none;
    font-size: var(--text-xs);
  }
  .foot a:nth-child(1) {
    color: var(--c-pink);
  }
  .foot a:nth-child(2) {
    color: var(--c-orange);
  }
  .foot a:nth-child(3) {
    color: var(--c-green);
  }
  .foot a:nth-child(4) {
    color: var(--c-sky);
  }
  .foot a:hover {
    background: var(--side-hover);
  }
</style>
