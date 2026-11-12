<script lang="ts">
  // SPEC2 10: Chip: a tag, optionally with a count or a remove mark. The hue follows the text.
  import type { Snippet } from "svelte";
  let { hue = 0, active = false, children, ...rest }: { hue?: number; active?: boolean; children?: Snippet; [k: string]: unknown } = $props();
</script>

<span class="chip h{hue % 6}" class:active {...rest}>{@render children?.()}</span>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    padding: var(--s-0) var(--s-2);
    border-radius: var(--r-pill);
    font-size: var(--text-xs);
    font-weight: 600;
    line-height: 1.6;
    white-space: nowrap;
  }
  .h0 {
    background: var(--tag-0-soft);
    color: var(--tag-0);
  }
  .h1 {
    background: var(--tag-1-soft);
    color: var(--tag-1);
  }
  .h2 {
    background: var(--tag-2-soft);
    color: var(--tag-2);
  }
  .h3 {
    background: var(--tag-3-soft);
    color: var(--tag-3);
  }
  .h4 {
    background: var(--tag-4-soft);
    color: var(--tag-4);
  }
  .h5 {
    background: var(--tag-5-soft);
    color: var(--tag-5);
  }
  .active {
    outline: 2px solid currentcolor;
    outline-offset: -2px;
  }
</style>
