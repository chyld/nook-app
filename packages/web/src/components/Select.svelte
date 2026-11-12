<script lang="ts">
  // SPEC2 10: Select: a native select with the app's look.
  import type { Snippet } from "svelte";
  import type { HTMLSelectAttributes } from "svelte/elements";
  type Props = HTMLSelectAttributes & { value?: string; children?: Snippet };
  let { value = $bindable(""), children, ...rest }: Props = $props();
</script>

<select class="select" bind:value {...rest}>
  {@render children?.()}
</select>

<style>
  .select {
    min-height: 2.25rem;
    padding: 0 var(--s-2);
    border: 1px solid var(--rule);
    border-radius: var(--r-md);
    background: var(--surface);
    color: var(--ink);
    font-size: var(--text-md);
    max-width: 100%;
  }
</style>
