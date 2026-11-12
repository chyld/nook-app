<script lang="ts">
  // SPEC2 10: Dialog: the one confirmation in view, with `confirm` and `cancel` (section 11).
  import { toasts } from "../stores/toasts.svelte.ts";
  import Button from "./Button.svelte";
  $effect(() => {
    if (toasts.asking) queueMicrotask(() => (document.querySelector('[data-testid="confirm"]') as HTMLElement | null)?.focus());
  });
</script>

{#if toasts.asking}
  {@const a = toasts.asking}
  <div class="overlay" role="presentation" onkeydown={(e) => e.key === "Escape" && toasts.answer(false)}>
    <div class="dialog" role="alertdialog" aria-modal="true" aria-label="Confirm">
      <p class="message">{a.message}</p>
      <div class="row">
        <Button variant="plain" data-testid="cancel" onclick={() => toasts.answer(false)}>{a.cancel}</Button>
        <Button variant={a.danger ? "danger" : "primary"} data-testid="confirm" onclick={() => toasts.answer(true)}>{a.ok}</Button>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-dialog);
    display: grid;
    place-items: center;
    padding: var(--s-4);
    background: var(--overlay);
  }
  .dialog {
    width: min(26rem, 100%);
    padding: var(--s-5);
    border-radius: var(--r-lg);
    background: var(--surface);
    box-shadow: var(--shadow-2);
  }
  .message {
    margin-bottom: var(--s-4);
    line-height: 1.5;
  }
  .row {
    display: flex;
    justify-content: flex-end;
    gap: var(--s-2);
  }
</style>
