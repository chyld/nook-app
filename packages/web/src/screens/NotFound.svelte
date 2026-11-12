<script lang="ts">
  import { router } from "../lib/router.svelte.ts";
</script>

<section class="nf">
  <h1>Not found</h1>
  <p>There is nothing at this address. <a href="/" onclick={(e) => (e.preventDefault(), router.go("/"))}>Go to your notes</a>.</p>
</section>

<style>
  .nf {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    padding: var(--s-6) 0;
  }
  h1 {
    font-family: var(--font-display);
    font-size: var(--text-2xl);
  }
</style>
