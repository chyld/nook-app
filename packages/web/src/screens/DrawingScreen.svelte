<script lang="ts">
  // SPEC-DRAWINGS 6: the drawing screen. The editor screen's layout, with the sidebar; the
  // header has the notes button, the title, the tags, the save status, Save, History and Move to
  // trash. Excalidraw (3.1) is loaded only now: the asset path is set first, then `mount.ts` is
  // imported. The open drawing's other state lives in the `editor` store, which asks this view
  // for the scene (4.3 to 4.5).
  import { onMount } from "svelte";
  import { cleanTag, cleanTitle, sceneOf } from "../../../core/src/index.ts";
  import { router } from "../lib/router.svelte.ts";
  import { clock, tagHue } from "../lib/format.ts";
  import { editor } from "../stores/editor.svelte.ts";
  import { drafts } from "../stores/drafts.svelte.ts";
  import { library } from "../stores/library.svelte.ts";
  import { session } from "../stores/session.svelte.ts";
  import { toasts } from "../stores/toasts.svelte.ts";
  import Button from "../components/Button.svelte";
  import Chip from "../components/Chip.svelte";
  import Icon from "../components/Icon.svelte";
  import type { DrawingHandle } from "../drawing/mount.ts";

  let { id, ontoggle }: { id: string; ontoggle: () => void } = $props();

  let host: HTMLElement | null = $state(null);
  let handle: DrawingHandle | null = null;
  /** "loading" while Excalidraw's script loads; "failed" when it could not be loaded. */
  let script = $state<"idle" | "loading" | "failed">("idle");
  let ready = $state(false);
  let started = false;
  let gone = false;

  const broken = $derived(editor.entry?.problem === "broken");
  const title = $derived(editor.nook.title);
  const tags = $derived(editor.nook.tags);

  // 4.3: Excalidraw reports a change on every pointer move; the store is told at most once per
  // 200 ms, always including the last change. `flush()` tells it at once.
  const THROTTLE = 200;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  function tell() {
    pending = false;
    editor.changed();
  }
  function changed() {
    if (!ready) return;
    if (timer) {
      pending = true;
      return;
    }
    tell();
    timer = setTimeout(function again() {
      if (pending) {
        tell();
        timer = setTimeout(again, THROTTLE);
      } else timer = null;
    }, THROTTLE);
  }
  /** Tells the store now, from the scene as it is. Excalidraw reports a change only after
   *  React has drawn it, so a change made in the same task as Save or leaving may not have
   *  been reported yet: the store always reads the live scene (review, 13-2). */
  function flush() {
    if (!ready) return;
    if (timer) clearTimeout(timer);
    timer = null;
    tell();
  }

  /** How long the drawing may take to become ready before the screen says it failed. */
  const READY_LIMIT = 60_000;

  const dark = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;

  /** Loads Excalidraw (once per page) and mounts it with the drawing read from the server. */
  async function start() {
    if (!host || gone) return;
    const scene = sceneOf(editor.loadedText);
    if (!scene) return;
    script = "loading";
    let m: typeof import("../drawing/mount.ts");
    try {
      // The path must be set before mount.ts's imports run (3.1).
      (window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = "/assets/excalidraw/";
      m = await import("../drawing/mount.ts");
    } catch {
      if (!gone) script = "failed";
      return;
    }
    if (gone || !host) return;
    script = "idle";
    const uid = session.user?.id ?? null;
    const failed = () => {
      if (gone || ready) return;
      handle?.unmount();
      handle = null;
      script = "failed";
    };
    let h: DrawingHandle;
    try {
      h = m.mountDrawing(host, {
      scene,
      theme: dark() ? "dark" : "light",
      libraryKey: uid ? m.libraryStorageKey(uid) : null,
      libraryReturnUrl: `${location.origin}/d/${id}`,
      onChange: changed,
      onLibraryNotKept: () => toasts.push("The shape library was not kept: this browser refused to store it (its storage is full or turned off).", "warn", 8000),
        onFailed: failed,
      });
    } catch {
      failed();
      return;
    }
    handle = h;
    // A drawing that never becomes ready (Excalidraw failed inside) says so (review, 02-7).
    const limit = setTimeout(failed, READY_LIMIT);
    await h.ready;
    clearTimeout(limit);
    // `failed` may have run meanwhile (an error inside Excalidraw, or the limit).
    if (gone || (script as string) === "failed") return;
    // Ready (4.3): the store takes its baseline as the view registers.
    editor.register({
      getText: () => editor.drawingText(),
      setText: () => {},
      flush,
      isReady: () => ready,
      scene: () => h.scene(),
      load: async (sc) => {
        ready = false;
        await h.load(sc);
        if (!gone) ready = true;
      },
    });
    ready = true;
    (window as unknown as { __drawing: unknown }).__drawing = {
      text: () => editor.drawingText(),
      addText: (text: string, x: number, y: number) => h.addText(text, x, y),
      setBackground: (colour: string) => h.setBackground(colour),
      addImage: (file: File) => h.addImage(file),
    };
  }

  $effect(() => {
    if (started || !host || editor.loading || editor.loadError || editor.wrongKind || editor.id !== id || editor.kind !== "drawing" || broken) return;
    started = true;
    void start();
  });

  function retry() {
    started = false;
    script = "idle";
    void start().then(() => (started = true));
  }

  onMount(() => {
    router.setGuard(async () => {
      if (!editor.unsaved()) return true;
      return toasts.confirm("This drawing has unsaved changes. Leave without saving? (A draft is kept in this browser.)", { ok: "Leave", danger: true });
    });
    const unload = (e: BeforeUnloadEvent) => {
      editor.flushDraft();
      if (editor.unsaved()) e.preventDefault();
    };
    // 3.3: Ctrl+S saves to Nook; Excalidraw never sees it. Only a ready drawing is saved (the
    // store checks too), with a title or tag still being typed taken in first (review, 24-2).
    const keys = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
        if (!ready) return;
        void save();
      }
    };
    window.addEventListener("beforeunload", unload);
    window.addEventListener("keydown", keys, true);
    void editor.open(id, "drawing");
    return () => {
      gone = true;
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("keydown", keys, true);
      router.setGuard(null);
      if (timer) clearTimeout(timer);
      flush();
      delete (window as { __drawing?: unknown }).__drawing;
      // The draft is stored from the scene before the view goes.
      editor.close();
      handle?.unmount();
      handle = null;
    };
  });

  async function save() {
    if (editingTitle) endTitle(true);
    if (tagText) addTag();
    flush();
    await editor.save();
  }

  // The title, click to edit.
  let editingTitle = $state(false);
  let titleText = $state("");
  function startTitle() {
    titleText = title;
    editingTitle = true;
  }
  function endTitle(commit: boolean) {
    if (!editingTitle) return;
    editingTitle = false;
    const t = cleanTitle(titleText);
    if (commit && t !== "" && t !== title) editor.setNook({ title: t });
  }

  // Tags beside the title.
  let tagText = $state("");
  function addTag() {
    const t = cleanTag(tagText);
    tagText = "";
    if (!t || tags.includes(t)) return;
    editor.setNook({ tags: [...tags, t] });
  }
  function tagKey(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === "," || e.key === " " || (e.key === "Tab" && !e.shiftKey && tagText !== "")) {
      e.preventDefault();
      addTag();
    } else if (e.key === "Backspace" && tagText === "" && tags.length) {
      e.preventDefault();
      editor.setNook({ tags: tags.slice(0, -1) });
    }
  }
  function tagInput(e: Event) {
    const el = e.target as HTMLInputElement;
    const ends = /[\s,]/.test(el.value);
    const clean = el.value.toLowerCase().replace(/[^a-z]/g, "");
    tagText = clean;
    el.value = clean;
    if (ends) addTag();
  }

  async function toTrash() {
    if (editor.unsaved() && !(await toasts.confirm("This drawing has unsaved changes. Move it to the trash anyway?", { ok: "Move to trash", danger: true }))) return;
    try {
      await library.trash(id);
      toasts.push("Moved to the trash.", "info");
      await router.go("/", { force: true });
    } catch (e) {
      toasts.push(`Not moved: ${e instanceof Error ? e.message : ""}`, "error");
    }
  }
  async function saveAsNew() {
    const nid = await editor.saveAsNew();
    if (nid) await router.go(`/d/${nid}`, { force: true });
  }
  const statusLabel = $derived({ saved: "Saved", dirty: "Unsaved changes", saving: "Saving…", error: "Not saved" }[editor.saveState]);
</script>

<div class="drawing-screen">
  <header class="header" data-header>
    <div class="row1">
      <Button variant="icon" data-testid="notes-button" aria-label="Show or hide the notes" title="Notes" onclick={ontoggle}><Icon name="menu" /></Button>
      <div class="titlebox">
        {#if editingTitle}
          <!-- svelte-ignore a11y_autofocus -->
          <input class="title-input" aria-label="Title" maxlength="300" data-testid="note-title" bind:value={titleText} autofocus onblur={() => endTitle(true)} onkeydown={(e) => (e.key === "Enter" ? (e.preventDefault(), endTitle(true)) : e.key === "Escape" ? (e.preventDefault(), endTitle(false)) : null)} />
        {:else}
          <button type="button" class="title" data-testid="note-title" title="Click to change the title" disabled={!ready} onclick={startTitle}>{editor.loading ? "" : title}</button>
        {/if}
        <div class="tags">
          {#each tags as t (t)}
            <span data-testid="tag" data-tag={t}><Chip hue={tagHue(t)}>{t}<button type="button" class="x" data-testid="tag-remove" aria-label={`Remove the tag ${t}`} onclick={() => editor.setNook({ tags: tags.filter((x) => x !== t) })}>×</button></Chip></span>
          {/each}
          <input class="taginput" placeholder="+ tag" maxlength="30" aria-label="Add a tag" autocapitalize="none" autocomplete="off" spellcheck="false" data-testid="tag-input" disabled={!ready} value={tagText} oninput={tagInput} onkeydown={tagKey} onblur={addTag} />
        </div>
      </div>
    </div>
    <div class="row2">
      <span class="status {editor.saveState}" data-testid="save-status" data-state={editor.saveState}>{statusLabel}</span>
      {#if editor.entry?.agent}<span class="by" data-testid="written-by" title="An agent wrote this text. It stays marked until you save a change.">Written by {editor.entry.agent}</span>{/if}
      <Button small variant="primary" data-testid="save" title="Save (Ctrl+S)" disabled={!ready || !!editor.loadError} onclick={save}><Icon name="save" size={16} /> Save</Button>
      <Button small data-testid="note-history" onclick={() => router.go(`/d/${id}/history`)}><Icon name="history" size={16} /> History</Button>
      <Button small variant="quiet" data-testid="note-trash" onclick={toTrash}><Icon name="trash" size={16} /> Move to trash</Button>
    </div>
  </header>

  {#if editor.conflict?.kind === "changed"}
    <div class="banner warn" role="alert">
      <span>This drawing was changed elsewhere since you opened it. Your drawing is kept.</span>
      <Button small variant="primary" data-testid="conflict-mine" onclick={() => editor.keepMine()}>Keep mine</Button>
      <Button small data-testid="conflict-theirs" onclick={() => editor.takeTheirs()}>Take theirs</Button>
    </div>
  {:else if editor.conflict?.kind === "gone"}
    <div class="banner warn" role="alert">
      <span>{editor.conflict.status === 410 ? "This drawing was moved to the trash." : "This drawing no longer exists."} Your drawing is kept.</span>
      <Button small variant="primary" data-testid="save-as-new" onclick={saveAsNew}>Save as a new drawing</Button>
    </div>
  {/if}
  {#each editor.offered as d (d.key)}
    <div class="banner info" data-testid="draft-row" data-id={d.noteId}>
      <span>An unsaved drawing from {clock(d.time)} was found. Open it or discard it.</span>
      <Button small variant="primary" data-testid="draft-open" disabled={!ready} onclick={() => editor.openDraft(d)}>Open</Button>
      <Button small data-testid="draft-discard" onclick={() => editor.discardDraft(d)}>Discard</Button>
    </div>
  {/each}
  {#if drafts.full}
    <div class="banner warn" role="alert">This browser is refusing to keep drafts (its storage is full or turned off). Save soon.</div>
  {/if}

  {#if editor.loadError}
    <div class="message"><p>{editor.loadError}</p><Button onclick={() => router.go("/")}>Back to your notes</Button></div>
  {:else if broken}
    <div class="message" data-testid="drawing-broken"><p>This drawing's file cannot be read: it is not an Excalidraw scene. It is left as it is.</p><Button onclick={() => router.go("/")}>Back to your notes</Button></div>
  {:else if script === "failed"}
    <div class="message" role="alert"><p>The drawing editor could not be loaded. Check the connection and try again.</p><Button variant="primary" data-testid="drawing-retry" onclick={retry}>Try again</Button></div>
  {/if}
  <div class="body">
    {#if (editor.loading || script === "loading" || (!ready && !editor.loadError && !broken && script !== "failed")) }
      <div class="loading" aria-live="polite">Loading the drawing…</div>
    {/if}
    <div class="excalidraw-host" class:gone={!!editor.loadError || broken} data-testid="drawing" data-ready={ready ? "true" : "false"} bind:this={host}></div>
  </div>
</div>

<style>
  .drawing-screen {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .header {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
    border-bottom: 1px solid var(--rule);
    flex-wrap: wrap;
  }
  .row1 {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    flex: 1;
    min-width: 0;
  }
  .row2 {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    margin-left: auto;
  }
  .titlebox {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-width: 0;
    flex: 1;
    flex-wrap: wrap;
  }
  .title,
  .title-input {
    font-family: var(--font-display);
    font-size: var(--text-xl);
    font-weight: 700;
    letter-spacing: -0.015em;
    color: var(--ink);
    min-width: 0;
  }
  .title {
    padding: 0 var(--s-1);
    border: 0;
    border-radius: var(--r-sm);
    background: transparent;
    text-align: left;
    cursor: text;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .title:hover {
    background: var(--surface-2);
  }
  .title-input {
    padding: 0 var(--s-1);
    border: 1px solid var(--accent);
    border-radius: var(--r-sm);
    background: var(--surface);
    width: min(28rem, 100%);
  }
  .tags {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    flex-wrap: wrap;
  }
  .x {
    padding: 0;
    margin-left: var(--s-0);
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .taginput {
    width: 5.5rem;
    min-height: 1.6rem;
    padding: 0 var(--s-2);
    border: 1px dashed var(--rule);
    border-radius: var(--r-pill);
    background: transparent;
    font-size: var(--text-xs);
  }
  .status {
    font-size: var(--text-xs);
    color: var(--ink-soft);
    padding: 0 var(--s-2);
  }
  .by {
    max-width: 14rem;
    padding: var(--s-0) var(--s-2);
    border-radius: var(--r-pill);
    background: var(--tag-0-soft);
    color: var(--tag-0);
    font-size: var(--text-xs);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .status.dirty {
    color: var(--c-orange);
  }
  .status.error {
    color: var(--danger);
  }
  .banner {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    flex-wrap: wrap;
    padding: var(--s-2) var(--s-3);
    font-size: var(--text-sm);
  }
  .banner.warn {
    background: var(--warn-soft);
    color: var(--warn-ink);
  }
  .banner.info {
    background: var(--info-soft);
  }
  .message {
    padding: var(--s-5);
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    align-items: flex-start;
  }
  .body {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
  }
  .loading {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ink-soft);
    background: var(--surface);
    z-index: var(--z-sheet);
  }
  .excalidraw-host {
    height: 100%;
  }
  .excalidraw-host.gone {
    display: none;
  }
  @media (max-width: 640px) {
    .header {
      padding: var(--s-1) var(--s-2);
    }
    .row2 {
      width: 100%;
      justify-content: flex-end;
    }
  }
</style>
