<script lang="ts">
  // SPEC2 10: Button (primary, plain, quiet, danger, icon), and lamp: the yellow of the logo's
  // lamp, for New drawing. `muted` is plain with soft ink (Save with nothing to save); `square`
  // is for a bordered button that holds only an icon.
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";
  type Props = HTMLButtonAttributes & { variant?: "primary" | "plain" | "quiet" | "danger" | "icon" | "lamp" | "muted"; small?: boolean; square?: boolean; pressed?: boolean | undefined; children?: Snippet; keepFocus?: boolean };
  let { variant = "plain", small = false, square = false, pressed = undefined, children, keepFocus = false, type = "button", ...rest }: Props = $props();
</script>

<button
  {type}
  class="btn {variant}"
  class:small
  class:square
  class:on={pressed === true}
  aria-pressed={pressed}
  onmousedown={keepFocus ? (e) => e.preventDefault() : undefined}
  {...rest}
>
  {@render children?.()}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
    min-height: 2.25rem;
    padding: 0 var(--s-3);
    border: 1px solid var(--rule);
    border-radius: var(--r-md);
    background: var(--surface);
    color: var(--ink);
    font-size: var(--text-md);
    font-weight: 550;
    cursor: pointer;
    white-space: nowrap;
  }
  .btn:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .small {
    min-height: 1.875rem;
    padding: 0 var(--s-2);
    font-size: var(--text-sm);
  }
  .primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 650;
  }
  .primary:hover:not(:disabled) {
    background: var(--accent-strong);
  }
  .muted {
    color: var(--ink-soft);
  }
  .square {
    min-width: 2.25rem;
    padding: 0 var(--s-2);
  }
  .square.small {
    min-width: 1.875rem;
    padding: 0 var(--s-1);
  }
  .lamp {
    border-color: var(--c-yellow);
    background: var(--c-yellow);
    color: var(--c-yellow-ink);
    font-weight: 650;
  }
  .lamp:hover:not(:disabled) {
    border-color: var(--c-yellow-strong);
    background: var(--c-yellow-strong);
  }
  .quiet {
    border-color: transparent;
    background: transparent;
    color: var(--ink-soft);
  }
  .quiet:hover:not(:disabled) {
    background: var(--side-hover);
    color: var(--ink);
  }
  .danger {
    border-color: var(--danger);
    background: var(--danger);
    color: var(--danger-ink);
  }
  .danger:hover:not(:disabled) {
    background: var(--danger);
  }
  .icon {
    min-width: 2.25rem;
    padding: 0 var(--s-2);
    border-color: transparent;
    background: transparent;
    color: var(--ink-soft);
  }
  .icon.small {
    min-width: 1.875rem;
  }
  .icon:hover:not(:disabled) {
    background: var(--side-hover);
    color: var(--ink);
  }
  .on {
    border-color: var(--accent-soft);
    background: var(--accent-soft);
    color: var(--accent-strong);
  }
</style>
