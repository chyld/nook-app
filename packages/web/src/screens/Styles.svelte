<script lang="ts">
  // SPEC2 9.1: saved styles: rename, edit as text, delete. New styles are made in the toolbar.
  import type { Style } from "../../../contract/src/index.ts";
  import { styles } from "../stores/styles.svelte.ts";
  import { toasts } from "../stores/toasts.svelte.ts";
  import { parseStyleText, previewCss, styleText } from "../lib/styletext.ts";
  import Button from "../components/Button.svelte";

  $effect(() => {
    void styles.load().catch((e) => toasts.push(e.message, "error"));
  });
  const texts = $state<Record<string, string>>({});
  const names = $state<Record<string, string>>({});
  const textOf = (s: Style) => texts[s.name] ?? styleText(s);
  const nameOf = (s: Style) => names[s.name] ?? s.name;

  async function saveText(s: Style) {
    const p = parseStyleText(s.name, textOf(s));
    if ("error" in p) {
      toasts.push(`Not saved: ${p.error}.`, "warn");
      return;
    }
    try {
      await styles.save(p);
      delete texts[s.name];
      toasts.push(`Style "${s.name}" saved.`, "info");
    } catch (e) {
      toasts.push(`Not saved: ${e instanceof Error ? e.message : ""}`, "error");
    }
  }
  async function rename(s: Style) {
    const n = nameOf(s).replace(/\s+/g, " ").trim();
    if (n === "" || n === s.name) return;
    try {
      await styles.save({ ...s, name: n }, s.name);
      delete names[s.name];
    } catch (e) {
      toasts.push(`Not renamed: ${e instanceof Error ? e.message : ""}`, "error");
    }
  }
  async function remove(s: Style) {
    if (!(await toasts.confirm(`Delete the style "${s.name}"?`, { ok: "Delete", danger: true }))) return;
    await styles.remove(s.name);
  }
</script>

<section class="styles">
  <h1>Styles</h1>
  <p class="intro">A style is a saved look for text. Make one in a note: set up some text, open Styles in the toolbar and save it. Here you can rename, change or delete them. The words a style uses: <code>font="Name" size=14 color=red bg=#fff176 bold italic underline strike</code>.</p>
  {#if styles.loaded && styles.list.length === 0}<p class="empty">No styles yet.</p>{/if}
  {#each styles.list as s (s.name)}
    <div class="row" data-testid="style-row" data-name={s.name}>
      <span class="sample" style={previewCss(s)}>The quick brown fox</span>
      <div class="fields">
        <input class="input" aria-label="Style name" maxlength="40" value={nameOf(s)} oninput={(e) => (names[s.name] = (e.target as HTMLInputElement).value)} onkeydown={(e) => e.key === "Enter" && rename(s)} />
        <Button small data-testid="style-rename" onclick={() => rename(s)}>Rename</Button>
        <input class="input wide" aria-label={`Style ${s.name} as text`} spellcheck="false" data-testid="style-text" value={textOf(s)} oninput={(e) => (texts[s.name] = (e.target as HTMLInputElement).value)} onkeydown={(e) => e.key === "Enter" && saveText(s)} />
        <Button small variant="primary" onclick={() => saveText(s)}>Save</Button>
        <Button small variant="quiet" data-testid="style-delete" onclick={() => remove(s)}>Delete</Button>
      </div>
    </div>
  {/each}
</section>

<style>
  .styles {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }
  h1 {
    font-family: var(--font-display);
    font-size: var(--text-2xl);
  }
  .intro,
  .empty {
    color: var(--ink-soft);
    line-height: 1.5;
  }
  code {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-3);
    border: 1px solid var(--rule);
    border-radius: var(--r-md);
  }
  .sample {
    align-self: flex-start;
    padding: 0 var(--s-1);
    border-radius: var(--r-sm);
  }
  .fields {
    display: flex;
    gap: var(--s-2);
    flex-wrap: wrap;
  }
  .input {
    min-height: 1.875rem;
    padding: 0 var(--s-2);
    border: 1px solid var(--rule);
    border-radius: var(--r-sm);
    background: var(--surface);
    min-width: 0;
  }
  .wide {
    flex: 1;
    min-width: 12rem;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }
</style>
