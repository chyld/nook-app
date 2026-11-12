<script lang="ts">
  // SPEC2 10: Popover: a panel under its trigger, closed by a click elsewhere or Escape. Under
  // 640 pixels a panel opened from the toolbar spans the screen (9.4).
  import type { Snippet } from "svelte";
  let { open = $bindable(false), trigger, children, label = "", wide = false }: { open?: boolean; trigger: Snippet; children: Snippet; label?: string; wide?: boolean } = $props();
  let root: HTMLElement | null = $state(null);

  $effect(() => {
    if (!open) return;
    const down = (e: Event) => {
      if (root && !root.contains(e.target as Node)) open = false;
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") open = false;
    };
    document.addEventListener("mousedown", down, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down, true);
      document.removeEventListener("keydown", key);
    };
  });
</script>

<div class="pop-anchor" bind:this={root}>
  {@render trigger()}
  {#if open}
    <div class="panel" class:wide role="dialog" aria-label={label}>
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .pop-anchor {
    position: relative;
    display: inline-flex;
  }
  .panel {
    position: absolute;
    top: calc(100% + var(--s-1));
    left: 0;
    z-index: var(--z-popover);
    min-width: 12rem;
    max-height: 70vh;
    overflow-y: auto;
    padding: var(--s-2);
    border: 1px solid var(--rule);
    border-radius: var(--r-lg);
    background: var(--surface);
    box-shadow: var(--shadow-2);
  }
  .panel.wide {
    min-width: 17rem;
  }
  @media (max-width: 640px) {
    .panel {
      position: fixed;
      top: auto;
      left: var(--s-2);
      right: var(--s-2);
      bottom: var(--s-2);
      min-width: 0;
    }
  }
</style>
