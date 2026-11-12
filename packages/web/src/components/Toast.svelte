<script lang="ts">
  // SPEC2 10: Toast: messages, each `toast` (section 11).
  import { toasts } from "../stores/toasts.svelte.ts";
</script>

<div class="toasts" aria-live="polite">
  {#each toasts.list as t (t.id)}
    <div class="toast {t.kind}" data-testid="toast" data-kind={t.kind} role={t.kind === "error" ? "alert" : "status"}>
      <span>{t.message}</span>
      <button type="button" class="x" aria-label="Dismiss" onclick={() => toasts.dismiss(t.id)}>×</button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    right: var(--s-4);
    bottom: var(--s-4);
    z-index: var(--z-toast);
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    max-width: min(26rem, calc(100vw - 2rem));
  }
  .toast {
    display: flex;
    align-items: flex-start;
    gap: var(--s-3);
    padding: var(--s-3) var(--s-4);
    border-radius: var(--r-md);
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow-2);
    font-size: var(--text-sm);
    line-height: 1.45;
    border-left: 4px solid var(--accent);
  }
  .warn {
    border-left-color: var(--c-orange);
  }
  .error {
    border-left-color: var(--danger);
  }
  .x {
    margin-left: auto;
    border: 0;
    background: transparent;
    color: var(--ink-soft);
    font-size: var(--text-lg);
    line-height: 1;
    cursor: pointer;
  }
</style>
