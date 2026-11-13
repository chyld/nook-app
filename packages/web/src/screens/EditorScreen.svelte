<script lang="ts">
  // SPEC2 9.4, 9.5, 8: the editor screen: header, toolbar, the CodeMirror view, conflicts and
  // drafts. The editor's text, selection and `typing` live in CodeMirror; the open note's other
  // state lives in the `editor` store.
  import { onMount } from "svelte";
  import { EditorSelection } from "@codemirror/state";
  import type { EditorView, KeyBinding } from "@codemirror/view";
  import { describe, describeCell, noteTitle, normalizeIntent, noteSizeOf, noteSpacing, readSettings, cleanTag, type Intent, type ToolbarState } from "../../../core/src/index.ts";
  import { assetUrl } from "../lib/api.ts";
  import { COMMANDS, CLEAR } from "../lib/commands.ts";
  import { renderInto, renderTableHtml, photoFile } from "../lib/render.ts";
  import { router } from "../lib/router.svelte.ts";
  import { clock, tagHue } from "../lib/format.ts";
  import { createNoteView, type NoteView } from "../editor/view.ts";
  import { dispatchIntent, setDispatchHooks } from "../editor/dispatch.ts";
  import { editorField } from "../editor/field.ts";
  import { activeCell, enterNewTable, flushActiveCell, leaveActiveCell, onCellChange } from "../editor/table.ts";
  import { prefs } from "../stores/prefs.svelte.ts";
  import { editor } from "../stores/editor.svelte.ts";
  import { drafts } from "../stores/drafts.svelte.ts";
  import { fonts } from "../stores/fonts.svelte.ts";
  import { library } from "../stores/library.svelte.ts";
  import { styles } from "../stores/styles.svelte.ts";
  import { toasts } from "../stores/toasts.svelte.ts";
  import Toolbar from "./Toolbar.svelte";
  import Button from "../components/Button.svelte";
  import Chip from "../components/Chip.svelte";
  import Icon from "../components/Icon.svelte";

  let { id, ontoggle }: { id: string; ontoggle: () => void } = $props();

  let host: HTMLElement | null = $state(null);
  let nv: NoteView | null = null;
  let st = $state<ToolbarState | null>(null);
  let inCell = $state(false);
  let text = $state("");
  /** The note's text size in points, for the tables drawn in Rich mode (review of alpha's changes, 20). */
  let noteSize = $state(12);
  let linkOpen = $state(false);
  let settingsOpen = $state(false);
  let rawTab = $state<"write" | "preview">("write");
  let preview: HTMLElement | null = $state(null);
  let fileInput: HTMLInputElement | null = $state(null);
  let slowCount = 0;
  let slowOffered = $state(false);

  const view = (): EditorView | null => nv?.view ?? null;
  const title = $derived(noteTitle(text));
  const settings = $derived(readSettings(text));
  const tags = $derived(settings.fields.tags.value.split(",").map((t) => t.trim()).filter(Boolean));

  /** The toolbar's state: `describe`, or `describeCell` while a cell has the focus. */
  function refresh() {
    const v = view();
    if (!v) return;
    text = v.state.doc.toString();
    const cell = activeCell();
    inCell = cell !== null;
    if (cell) {
      const [a, b] = cell.selection();
      st = describeCell(cell.source(), a, b);
    } else {
      const f = v.state.field(editorField);
      noteSize = noteSizeOf(f.model);
      const main = v.state.selection.main;
      st = describe({ text, sel: { anchor: main.anchor, head: main.head }, typing: f.typing }, f.model);
    }
  }

  /** Every toolbar control and header setting sends its intent here. */
  function send(i: Intent): boolean {
    const v = view();
    if (!v) return false;
    const cell = activeCell();
    if (cell) {
      if (i.type === "setMark") cell.style(i.change);
      else toasts.push("This works on the note's text, not inside a table cell.", "info");
      refresh();
      return true;
    }
    const newTable = i.type === "insertBlock" && i.what === "table";
    const ok = dispatchIntent(v, i);
    // A new table is entered at once: its first cell gets the caret, with its text selected so
    // that typing replaces "Column 1". The dispatch has drawn it already.
    if (ok && newTable && editor.mode === "rich") {
      enterNewTable(v);
      refresh();
      return ok;
    }
    // Toolbar buttons never take the focus; a header field (title, tags, size) keeps it, or the
    // key that sent the intent would reach the editor once it had the focus.
    if (!document.activeElement || document.activeElement === document.body) v.focus();
    refresh();
    return ok;
  }

  const keys: KeyBinding[] = [
    ...COMMANDS.filter((c) => c.keys && c.intent).flatMap((c) => c.keys!.map((key) => ({ key, preventDefault: true, run: () => (st && send(c.intent!(st)), true) }))),
    // 7.6: with nothing selected, Ctrl+K is refused (review, 29).
    { key: "Mod-k", preventDefault: true, run: (v) => (v.state.selection.main.empty ? toasts.push("Select some text first.", "warn") : (linkOpen = true), true) },
    { key: "Mod-\\", preventDefault: true, run: () => (send(CLEAR), true) },
  ];

  async function upload(files: File[]) {
    for (const f of files) {
      try {
        const file = await editor.upload(f);
        const v = view();
        if (v) dispatchIntent(v, { type: "insertPhoto", file });
      } catch (e) {
        toasts.push(`The photo was not added: ${e instanceof Error ? e.message : ""}`, "error");
      }
    }
  }

  onMount(() => {
    setDispatchHooks({
      message: (m, kind) => toasts.push(m, kind),
      timed: (ms) => {
        slowCount = ms > 50 ? slowCount + 1 : 0;
        if (slowCount >= 3 && !slowOffered && editor.mode === "rich") slowOffered = true;
      },
    });
    router.setGuard(async () => {
      // A focused table cell's text is written first (7.7), so it counts as unsaved.
      if (!editor.unsaved()) return true;
      return toasts.confirm("This note has unsaved changes. Leave without saving? (A draft is kept in this browser.)", { ok: "Leave", danger: true });
    });
    const unload = (e: BeforeUnloadEvent) => {
      // The draft is stored with a focused table cell's text written in (7.7).
      editor.flushDraft();
      if (editor.unsaved()) e.preventDefault();
    };
    window.addEventListener("beforeunload", unload);
    const offCell = onCellChange(refresh);
    // A drawing's address is gone to instead, with no view made (SPEC-DRAWINGS 6).
    void editor.open(id, "note");
    if (!styles.loaded) void styles.load().catch(() => {});
    return () => {
      window.removeEventListener("beforeunload", unload);
      offCell();
      router.setGuard(null);
      delete (window as { __notes?: unknown }).__notes;
      // The draft is stored from the view's text before the view goes.
      editor.close();
      nv?.destroy();
      nv = null;
    };
  });

  // The view, once the note is loaded.
  $effect(() => {
    if (!host || editor.loading || editor.loadError || nv || editor.id !== id || editor.kind !== "note") return;
    nv = createNoteView({
      parent: host,
      text: editor.loadedText,
      mode: editor.mode,
      invisibles: prefs.invisibles,
      photoUrl: (dest) => {
        const f = photoFile(dest);
        return f ? assetUrl(id, f) : null;
      },
      renderTable: (md) => renderTableHtml(md, (f) => assetUrl(id, f)),
      keys,
      onSave: () => void save(),
      onChange: () => editor.changed(),
      onUpdate: refresh,
      onFiles: (_v, files) => void upload(files),
      onLink: () => {
        refresh();
        linkOpen = true;
      },
      keepsTyping: (t) => !!t?.closest?.("[data-toolbar], [data-header]"),
    });
    const made = nv;
    editor.register({ getText: () => made.view.state.doc.toString(), setText: (t) => made.setText(t), flush: flushActiveCell });
    (window as unknown as { __notes: unknown }).__notes = {
      text: () => nv?.view.state.doc.toString() ?? "",
      select: (from: number, to: number = from) => {
        const v = view();
        if (!v) return;
        const len = v.state.doc.length;
        v.dispatch({ selection: EditorSelection.single(Math.max(0, Math.min(from, len)), Math.max(0, Math.min(to, len))), userEvent: "select.pointer" });
        v.focus();
      },
      intent: (i: unknown) => {
        const n = normalizeIntent(i);
        if (!n) return false;
        return send(n);
      },
    };
    refresh();
    if (editor.mode === "rich" && editor.entry?.problem === "broken") setMode("raw");
    nv.view.focus();
  });

  async function save() {
    // A table cell being edited is written first (7.7), by the store's save.
    await editor.save();
  }

  function setMode(m: "rich" | "raw") {
    if (m === "rich" && editor.entry?.problem === "broken" && settings.broken) {
      toasts.push("The front matter does not parse, so this note opens in Raw. Fix it there first.", "warn");
      return;
    }
    // A table cell being edited is written before the table stops being drawn as cells (7.7).
    leaveActiveCell();
    editor.setMode(m);
    nv?.setMode(m);
    rawTab = "write";
    refresh();
    nv?.view.focus();
  }

  $effect(() => {
    if (editor.mode === "raw" && rawTab === "preview" && preview) renderInto(preview, text, (f) => assetUrl(id, f));
  });

  // Title, click to edit.
  let editingTitle = $state(false);
  let titleText = $state("");
  function startTitle() {
    if (settings.broken) return;
    titleText = settings.fields.title.value || title;
    editingTitle = true;
  }
  function endTitle(commit: boolean) {
    if (!editingTitle) return;
    editingTitle = false;
    if (commit && titleText.trim() !== (settings.fields.title.value || title)) send({ type: "setMeta", key: "title", value: titleText });
  }

  // Tags beside the title.
  let tagText = $state("");
  function addTag() {
    const t = cleanTag(tagText);
    tagText = "";
    if (!t || tags.includes(t)) return;
    send({ type: "setMeta", key: "tags", value: [...tags, t] });
  }
  function tagKey(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === "," || e.key === " " || (e.key === "Tab" && !e.shiftKey && tagText !== "")) {
      e.preventDefault();
      addTag();
      (e.target as HTMLInputElement).focus();
    } else if (e.key === "Backspace" && tagText === "" && tags.length) {
      e.preventDefault();
      send({ type: "setMeta", key: "tags", value: tags.slice(0, -1) });
      (e.target as HTMLInputElement).focus();
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

  // Note settings: font and size, History, Move to trash.
  let sizeText = $state("");
  $effect(() => {
    sizeText = settings.fields.size.value.replace(/pt$/, "");
  });
  function setNoteSize() {
    const v = sizeText.trim();
    if (v === "") return send({ type: "setMeta", key: "size", value: null });
    if (!/^\d{1,3}(\.\d)?$/.test(v) || Number(v) < 1 || Number(v) > 400) {
      toasts.push("A size is a number from 1 to 400, with one decimal at most.", "warn");
      return;
    }
    send({ type: "setMeta", key: "size", value: `${Number(v)}pt` });
  }
  // Paragraph spacing: a multiple of the usual gap, kept in the note's front matter.
  const SPACINGS: [string, string][] = [
    ["0.3", "Very tight"],
    ["0.6", "Tight"],
    ["1", "Normal"],
    ["1.5", "Roomy"],
    ["2", "Wide"],
    ["3", "Very wide"],
  ];
  const spacing = $derived(noteSpacing(text));
  const spacingValue = $derived(String(spacing));

  async function toTrash() {
    if (editor.unsaved() && !(await toasts.confirm("This note has unsaved changes. Move it to the trash anyway?", { ok: "Move to trash", danger: true }))) return;
    try {
      await library.trash(id);
      toasts.push("Moved to the trash.", "info");
      await router.go("/", { force: true });
    } catch (e) {
      toasts.push(`Not moved: ${e instanceof Error ? e.message : ""}`, "error");
    }
  }
  async function makeNote() {
    if (editor.unsaved() && !(await toasts.confirm("This note has unsaved changes. Leave without saving? (A draft is kept in this browser.)", { ok: "Leave", danger: true }))) return;
    try {
      const nid = await library.create();
      await router.go(`/n/${nid}`, { force: true });
    } catch (e) {
      toasts.push(`The note could not be made: ${e instanceof Error ? e.message : ""}`, "error");
    }
  }
  async function saveAsNew() {
    const nid = await editor.saveAsNew();
    if (nid) await router.go(`/n/${nid}`, { force: true });
  }
  async function saveStyle(name: string) {
    if (!st) return;
    const s = st;
    try {
      await styles.save({
        name,
        bold: s.bold === "on",
        italic: s.italic === "on",
        underline: s.underline === "on",
        strike: s.strike === "on",
        size: s.size.mixed || s.size.value === null ? null : s.size.value,
        font: s.font.mixed ? null : (s.font.value ?? null),
        color: s.color.mixed ? null : (s.color.value ?? null),
        bg: s.bg.mixed ? null : (s.bg.value ?? null),
      });
      toasts.push(`Style "${name}" saved.`, "info");
    } catch (e) {
      toasts.push(`Not saved: ${e instanceof Error ? e.message : ""}`, "error");
    }
  }
  const statusLabel = $derived({ saved: "Saved", dirty: "Unsaved changes", saving: "Saving…", error: editor.conflict ? "Not saved" : "Not saved" }[editor.saveState]);
  const myFonts = $derived(fonts.mine.map((f) => f.family));
</script>

<div class="editor-screen">
  <header class="header" data-header>
    <div class="row1">
      <Button variant="icon" data-testid="notes-button" aria-label="Show or hide the notes" title="Notes" onclick={ontoggle}><Icon name="menu" /></Button>
      <div class="titlebox">
        {#if editingTitle}
          <!-- svelte-ignore a11y_autofocus -->
          <input class="title-input" aria-label="Title" maxlength="300" data-testid="note-title" bind:value={titleText} autofocus onblur={() => endTitle(true)} onkeydown={(e) => (e.key === "Enter" ? (e.preventDefault(), endTitle(true)) : e.key === "Escape" ? (e.preventDefault(), endTitle(false)) : null)} />
        {:else}
          <button type="button" class="title" data-testid="note-title" title={settings.broken ? "Fix the front matter in Raw to change the title" : "Click to change the title"} onclick={startTitle}>{editor.loading ? "" : title}</button>
        {/if}
        <div class="tags">
          {#each tags as t (t)}
            <span data-testid="tag" data-tag={t}><Chip hue={tagHue(t)}>{t}<button type="button" class="x" data-testid="tag-remove" aria-label={`Remove the tag ${t}`} onclick={() => send({ type: "setMeta", key: "tags", value: tags.filter((x) => x !== t) })}>×</button></Chip></span>
          {/each}
          <input class="taginput" placeholder="+ tag" maxlength="30" aria-label="Add a tag" autocapitalize="none" autocomplete="off" spellcheck="false" data-testid="tag-input" disabled={settings.broken || !settings.fields.tags.writable} value={tagText} oninput={tagInput} onkeydown={tagKey} onblur={addTag} />
        </div>
      </div>
    </div>
    <div class="row2">
      <span class="status {editor.saveState}" data-testid="save-status" data-state={editor.saveState}>{statusLabel}</span>
      {#if editor.entry?.agent}<span class="by" data-testid="written-by" title="An agent wrote this text. It stays marked until you save a change.">Written by {editor.entry.agent}</span>{/if}
      <Button small keepFocus data-testid="mode-toggle" title={`Now ${editor.mode === "rich" ? "Rich" : "Raw"}; switch to ${editor.mode === "rich" ? "Raw" : "Rich"}`} onclick={() => setMode(editor.mode === "rich" ? "raw" : "rich")}>{editor.mode === "rich" ? "Rich" : "Raw"}</Button>
      <Button small variant="icon" data-testid="note-settings" aria-label="Note settings" title="Note settings" pressed={settingsOpen} onclick={() => (settingsOpen = !settingsOpen)}><Icon name="settings" /></Button>
      <Button small variant="icon" aria-label="New note" title="New note" onclick={makeNote}><Icon name="plus" /></Button>
      <Button small keepFocus variant="primary" data-testid="save" title="Save (Ctrl+S)" disabled={editor.loading || !!editor.loadError} onclick={save}><Icon name="save" size={16} /> Save</Button>
    </div>
  </header>

  {#if settingsOpen}
    <div class="settings" data-header>
      <label class="set">
        <span>Note font</span>
        <select data-testid="note-font" disabled={settings.broken || !settings.fields.font.writable} title={settings.fields.font.writable ? "" : "Read-only: edit in Raw"} value={settings.fields.font.value || "serif"} onchange={(e) => {
          const v = (e.target as HTMLSelectElement).value;
          send({ type: "setMeta", key: "font", value: v === "serif" ? null : v });
        }}>
          <option value="serif">Serif</option>
          <option value="sans">Sans</option>
          <option value="mono">Mono</option>
          {#each myFonts as f (f)}<option value={f}>{f}</option>{/each}
        </select>
      </label>
      <label class="set">
        <span>Note size</span>
        <input class="num" data-testid="note-size" inputmode="decimal" placeholder="12" disabled={settings.broken || !settings.fields.size.writable} bind:value={sizeText} onkeydown={(e) => e.key === "Enter" && (e.preventDefault(), setNoteSize())} onblur={setNoteSize} />
      </label>
      <label class="set">
        <span>Paragraph spacing</span>
        <select data-testid="note-spacing" disabled={settings.broken || !settings.fields.spacing.writable} title={settings.fields.spacing.writable ? "The space between paragraphs in this note" : "Read-only: edit in Raw"} value={spacingValue} onchange={(e) => send({ type: "setMeta", key: "spacing", value: (e.target as HTMLSelectElement).value })}>
          {#each SPACINGS as [v, l] (v)}<option value={v}>{l}</option>{/each}
          {#if !SPACINGS.some(([v]) => Number(v) === spacing)}<option value={spacingValue}>{spacingValue} ×</option>{/if}
        </select>
      </label>
      <Button small data-testid="note-history" onclick={() => router.go(`/n/${id}/history`)}><Icon name="history" size={16} /> History</Button>
      <Button small variant="quiet" data-testid="note-trash" onclick={toTrash}><Icon name="trash" size={16} /> Move to trash</Button>
      {#if settings.broken}<span class="warn">The front matter does not parse; these settings are off. Edit it in Raw.</span>{/if}
    </div>
  {/if}

  <Toolbar invisibles={prefs.invisibles} oninvisibles={() => (prefs.setInvisibles(!prefs.invisibles), nv?.setInvisibles(prefs.invisibles))} st={st ?? describeCell("", 0, 0)} noteFont={settings.fields.font.value || null} {myFonts} savedStyles={styles.list} {inCell} {send} onphoto={() => fileInput?.click()} onsavestyle={saveStyle} bind:linkOpen />
  <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" class="file" data-testid="photo-input" bind:this={fileInput} onchange={(e) => {
    const el = e.target as HTMLInputElement;
    void upload(Array.from(el.files ?? []));
    el.value = "";
  }} />

  {#if editor.conflict?.kind === "changed"}
    <div class="banner warn" role="alert">
      <span>This note was changed elsewhere since you opened it. Your text is kept.</span>
      <Button small variant="primary" data-testid="conflict-mine" onclick={() => editor.keepMine()}>Keep mine</Button>
      <Button small data-testid="conflict-theirs" onclick={() => editor.takeTheirs()}>Take theirs</Button>
    </div>
  {:else if editor.conflict?.kind === "gone"}
    <div class="banner warn" role="alert">
      <span>{editor.conflict.status === 410 ? "This note was moved to the trash." : "This note no longer exists."} Your text is kept.</span>
      <Button small variant="primary" data-testid="save-as-new" onclick={saveAsNew}>Save as a new note</Button>
    </div>
  {/if}
  {#if editor.rescued}
    <div class="banner info">
      <span>Your text was kept as a draft. Copy what you need:</span>
      <textarea class="rescued" readonly aria-label="Your text">{editor.rescued}</textarea>
      <Button small onclick={() => editor.dismissRescued()}>Close</Button>
    </div>
  {/if}
  {#each editor.offered as d (d.key)}
    <div class="banner info" data-testid="draft-row" data-id={d.noteId}>
      <span>Unsaved text from {clock(d.time)} was found. Open it or discard it.</span>
      <Button small variant="primary" data-testid="draft-open" onclick={() => editor.openDraft(d)}>Open</Button>
      <Button small data-testid="draft-discard" onclick={() => editor.discardDraft(d)}>Discard</Button>
    </div>
  {/each}
  {#if drafts.full}
    <div class="banner warn" role="alert">This browser is refusing to keep drafts (its storage is full or turned off). Save soon.</div>
  {/if}
  {#if slowOffered}
    <div class="banner info">
      <span>This note is large, and Rich mode is slow on it.</span>
      <Button small onclick={() => ((slowOffered = false), setMode("raw"))}>Switch to Raw</Button>
      <Button small variant="quiet" onclick={() => (slowOffered = false)}>Stay in Rich</Button>
    </div>
  {/if}

  {#if editor.loadError}
    <div class="error"><p>{editor.loadError}</p><Button onclick={() => router.go("/")}>Back to your notes</Button></div>
  {/if}
  {#if editor.mode === "raw" && !editor.loadError}
    <div class="tabs" role="tablist">
      <button type="button" role="tab" class:on={rawTab === "write"} aria-selected={rawTab === "write"} data-testid="tab-write" onclick={() => (rawTab = "write")}>Write</button>
      <button type="button" role="tab" class:on={rawTab === "preview"} aria-selected={rawTab === "preview"} data-testid="tab-preview" onclick={() => (rawTab = "preview")}>Preview</button>
    </div>
  {/if}
  <div class="body">
    <div class="host" class:gone={editor.mode === "raw" && rawTab === "preview"} style={`--note-gap: ${spacing}; --note-text-size: ${noteSize}pt`} bind:this={host}></div>
    {#if editor.mode === "raw" && rawTab === "preview"}
      <article class="note preview" data-testid="preview" bind:this={preview}></article>
    {/if}
  </div>
</div>

<style>
  .editor-screen {
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
  .settings {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    flex-wrap: wrap;
    padding: var(--s-2) var(--s-3);
    border-bottom: 1px solid var(--rule);
    background: var(--surface-2);
  }
  .set {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-size: var(--text-sm);
  }
  .set select,
  .num {
    min-height: 1.875rem;
    padding: 0 var(--s-2);
    border: 1px solid var(--rule);
    border-radius: var(--r-sm);
    background: var(--surface);
  }
  .num {
    width: 4rem;
  }
  .warn {
    color: var(--warn-ink);
    font-size: var(--text-sm);
  }
  .file {
    display: none;
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
  .rescued {
    width: 100%;
    min-height: 6rem;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
  .error {
    padding: var(--s-5);
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    align-items: flex-start;
  }
  .tabs {
    display: flex;
    gap: var(--s-1);
    padding: var(--s-1) var(--s-3) 0;
  }
  .tabs button {
    padding: var(--s-1) var(--s-3);
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .tabs button.on {
    border-bottom-color: var(--accent);
    color: var(--ink);
  }
  .body {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
  }
  .host {
    height: 100%;
  }
  .host.gone {
    display: none;
  }
  .preview {
    height: 100%;
    overflow-y: auto;
    padding: var(--s-4) var(--s-5);
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
