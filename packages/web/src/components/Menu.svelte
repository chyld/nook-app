<script lang="ts">
  // SPEC2 10: Menu: a button that opens a list of choices. Every choice is `menu-item` with
  // `data-value` (section 11). Choices do not take the focus from the editor.
  import Popover from "./Popover.svelte";
  import Icon from "./Icon.svelte";
  import type { MenuItem } from "./menu.ts";
  let {
    label,
    title = "",
    items,
    onselect,
    testid,
    disabled = false,
    icon = "",
    swatches = false,
  }: { label: string; title?: string; items: MenuItem[]; onselect: (v: string) => void; testid: string; disabled?: boolean; icon?: string; swatches?: boolean } = $props();
  let open = $state(false);
</script>

<Popover bind:open {label}>
  {#snippet trigger()}
    <button type="button" class="trigger" data-testid={testid} {title} aria-label={title || label} aria-haspopup="true" aria-expanded={open} {disabled} onmousedown={(e) => e.preventDefault()} onclick={() => (open = !open)}>
      {#if icon}<Icon name={icon} />{/if}
      <span class="text">{label}</span>
      <Icon name="chevron" size={14} />
    </button>
  {/snippet}
  <div class="items" class:swatches role="menu">
    {#each items as it (it.value)}
      <button type="button" role="menuitem" class="item" class:sel={it.selected} data-testid="menu-item" data-value={it.value} title={it.label} style={it.style} onmousedown={(e) => e.preventDefault()} onclick={() => ((open = false), onselect(it.value))}>
        {#if it.swatch}<span class="swatch" style={`background-color: ${it.swatch}`}></span>{/if}
        <span class="label" class:sr-only={swatches && !!it.swatch}>{it.label}</span>
      </button>
    {/each}
  </div>
</Popover>

<style>
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    min-height: 2rem;
    padding: 0 var(--s-2);
    border: 1px solid transparent;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--ink);
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition:
      background-color 0.12s ease,
      color 0.12s ease;
  }
  /* A toolbar group sets --tb-hover and --tb-ink to its own colours. */
  .trigger:hover:not(:disabled),
  .trigger[aria-expanded="true"] {
    background: var(--tb-hover, var(--side-hover));
    color: var(--tb-ink, var(--ink));
  }
  .trigger:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .text {
    max-width: 9rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .items {
    display: flex;
    flex-direction: column;
    gap: var(--s-0);
  }
  .items.swatches {
    display: grid;
    grid-template-columns: repeat(6, 2rem);
    gap: var(--s-1);
  }
  .item {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-1) var(--s-2);
    border: 0;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--ink);
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
  }
  .item:hover,
  .item.sel {
    background: var(--accent-soft);
  }
  .swatches .item {
    justify-content: center;
    padding: var(--s-1);
  }
  .swatches .item:not(:has(.swatch)) {
    grid-column: 1 / -1;
  }
  .swatch {
    width: 1.25rem;
    height: 1.25rem;
    border-radius: var(--r-pill);
    border: 1px solid var(--rule);
  }
</style>
