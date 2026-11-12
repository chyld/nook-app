<script lang="ts">
  // SPEC2 10: Field: a labelled input.
  import type { HTMLInputAttributes } from "svelte/elements";
  type Props = HTMLInputAttributes & { label?: string; hint?: string; value?: string; input?: HTMLInputElement | null };
  let { label = "", hint = "", value = $bindable(""), input = $bindable(null), ...rest }: Props = $props();
</script>

<label class="field">
  {#if label}<span class="label">{label}</span>{/if}
  <input bind:value bind:this={input} {...rest} />
  {#if hint}<span class="hint">{hint}</span>{/if}
</label>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    min-width: 0;
  }
  .label {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink-soft);
  }
  .hint {
    font-size: var(--text-xs);
    color: var(--ink-soft);
  }
  input {
    min-height: 2.25rem;
    padding: 0 var(--s-3);
    border: 1px solid var(--rule);
    border-radius: var(--r-md);
    background: var(--surface);
    color: var(--ink);
    font-size: var(--text-md);
    min-width: 0;
  }
  input:focus {
    border-color: var(--accent);
    outline: none;
  }
</style>
