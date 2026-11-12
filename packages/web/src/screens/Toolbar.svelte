<script lang="ts">
  // SPEC2 9.4: the toolbar, the same in both modes, drawn from the command table and from
  // `describe` (or `describeCell` while a cell has the focus). It reads nothing else from the DOM.
  import type { Style } from "../../../contract/src/index.ts";
  import type { Change, Intent, ToolbarState } from "../../../core/src/index.ts";
  import { BLOCKS, command, INSERTS, LISTS } from "../lib/commands.ts";
  import { HIGHLIGHTS, noteColour, PALETTE } from "../palette.ts";
  import { previewCss } from "../lib/styletext.ts";
  import { familyStyle } from "../lib/fontcss.ts";
  import Menu from "../components/Menu.svelte";
  import Popover from "../components/Popover.svelte";
  import Icon from "../components/Icon.svelte";
  import { toasts } from "../stores/toasts.svelte.ts";

  let {
    st,
    noteFont,
    myFonts,
    savedStyles,
    inCell = false,
    send,
    onphoto,
    onsavestyle,
    linkOpen = $bindable(false),
    invisibles = false,
    oninvisibles,
  }: {
    st: ToolbarState;
    noteFont: string | null;
    myFonts: string[];
    savedStyles: readonly Style[];
    inCell?: boolean;
    send: (i: Intent) => void;
    onphoto: () => void;
    onsavestyle: (name: string) => void;
    linkOpen?: boolean;
    invisibles?: boolean;
    oninvisibles?: () => void;
  } = $props();

  const can = (id: string) => st.can[id] !== false;
  const mark = (change: Change) => send({ type: "setMark", change });
  const press = (id: Parameters<typeof command>[0]) => {
    const c = command(id);
    if (c.intent) send(c.intent(st));
  };

  // Font: the person's fonts, then Mono, Sans and Serif. No "Default": choosing the note's own font
  // takes the text's own font away.
  const fontNow = $derived(st.font.mixed ? null : (st.font.value ?? noteFont ?? "serif"));
  // The person's own fonts first, then the built-in three, each part in alphabetical order.
  const fontItems = $derived([
    ...[...myFonts].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })).map((f) => ({ value: f, label: f, style: familyStyle(f, "inherit"), selected: fontNow === f })),
    ...[
      ["mono", "Mono"],
      ["sans", "Sans"],
      ["serif", "Serif"],
    ].map(([v, l]) => ({ value: v, label: l, style: `font-family: var(--note-font-${v})`, selected: fontNow?.toLowerCase() === v })),
  ]);
  const fontLabel = $derived(st.font.mixed ? "Font" : (fontItems.find((i) => i.selected)?.label ?? fontNow ?? "Serif"));
  function pickFont(v: string) {
    const own = (noteFont ?? "serif").toLowerCase();
    mark({ kind: "font", value: v.toLowerCase() === own ? null : v });
  }

  // Size: − [box] +.
  let sizeText = $state("");
  let sizeFocus = $state(false);
  $effect(() => {
    if (!sizeFocus) sizeText = st.size.mixed || st.size.value === null ? "" : String(Math.round(st.size.value * 10) / 10);
  });
  function applySize() {
    const v = sizeText.trim();
    if (v === "") return;
    if (!/^\d{1,3}(\.\d)?$/.test(v) || Number(v) < 1 || Number(v) > 400) {
      toasts.push("A size is a number from 1 to 400, with one decimal at most.", "warn");
      return;
    }
    mark({ kind: "size", pt: Number(v) });
    refocus();
  }

  const colourItems = $derived([...PALETTE.map((c) => ({ value: c, label: c, swatch: noteColour(c), selected: !st.color.mixed && st.color.value === c })), { value: "none", label: "None" }]);
  const bgItems = $derived([...HIGHLIGHTS.map(([n, hex]) => ({ value: n, label: n, swatch: hex, selected: !st.bg.mixed && st.bg.value === hex })), { value: "none", label: "None" }]);
  const hexOf = (name: string) => HIGHLIGHTS.find(([n]) => n === name)?.[1] ?? name;

  const blockLabel = $derived(BLOCKS.find(([v]) => v === st.block)?.[1] ?? "Block");
  const listLabel = $derived(LISTS.find(([v]) => v === st.list)?.[1] ?? "List");

  // Link panel.
  let address = $state("");
  $effect(() => {
    if (linkOpen) address = st.link ?? "";
  });
  function applyLink() {
    const url = address.trim();
    if (!url) return;
    linkOpen = false;
    send({ type: "setLink", href: url });
    refocus();
  }
  /** After a field of the toolbar (the link address, the size box), the editor has the focus again. */
  function refocus() {
    queueMicrotask(() => (document.querySelector(".cm-content") as HTMLElement | null)?.focus());
  }

  // Styles: the matching saved style's name, else "Styles".
  const styleNow = $derived({
    bold: st.bold === "on",
    italic: st.italic === "on",
    underline: st.underline === "on",
    strike: st.strike === "on",
    size: st.size.mixed ? undefined : st.size.value,
    font: st.font.mixed ? undefined : (st.font.value ?? null),
    color: st.color.mixed ? undefined : (st.color.value ?? null),
    bg: st.bg.mixed ? undefined : (st.bg.value ?? null),
  });
  const matching = $derived(
    savedStyles.find(
      (s) =>
        s.bold === styleNow.bold &&
        s.italic === styleNow.italic &&
        s.underline === styleNow.underline &&
        s.strike === styleNow.strike &&
        (s.size === null || s.size === styleNow.size) &&
        (s.font ?? null) === (styleNow.font ?? null) &&
        (s.color ?? null) === (styleNow.color ?? null) &&
        (s.bg ?? null) === (styleNow.bg ?? null),
    )?.name ?? "Styles",
  );
  let stylesOpen = $state(false);
  let styleName = $state("");
  function saveStyle() {
    const n = styleName.replace(/\s+/g, " ").trim();
    if (!n) return;
    onsavestyle(n);
    styleName = "";
  }
</script>

<div class="toolbar" role="toolbar" aria-label="Formatting" data-toolbar>
  <div class="group g0">
    <Menu label={fontLabel} title="Font" testid="cmd-font" items={fontItems} disabled={!can("font")} onselect={pickFont} />
  </div>
  <div class="group size g4">
    <button type="button" class="tb" data-testid="cmd-size-down" title="Smaller (Ctrl+Shift+,)" aria-label="Smaller" disabled={!can("size-down")} onmousedown={(e) => e.preventDefault()} onclick={() => press("size-down")}>−</button>
    <input class="sizebox" data-testid="cmd-size" aria-label="Size in points" inputmode="decimal" maxlength="5" disabled={!can("size")} bind:value={sizeText} onfocus={() => (sizeFocus = true)} onblur={() => (sizeFocus = false)} onkeydown={(e) => e.key === "Enter" && (e.preventDefault(), applySize())} />
    <button type="button" class="tb" data-testid="cmd-size-up" title="Larger (Ctrl+Shift+.)" aria-label="Larger" disabled={!can("size-up")} onmousedown={(e) => e.preventDefault()} onclick={() => press("size-up")}>+</button>
  </div>
  <div class="group g1">
    {#each [["bold", "B", "Bold (Ctrl+B)"], ["italic", "I", "Italic (Ctrl+I)"], ["underline", "U", "Underline (Ctrl+U)"], ["strike", "S", "Strikethrough (Ctrl+Shift+X)"]] as [id, letter, title] (id)}
      {@const c = command(id as "bold")}
      <button type="button" class="tb letter {id}" data-testid={`cmd-${id}`} {title} aria-label={c.label} aria-pressed={c.lit?.(st) ?? false} class:on={c.lit?.(st)} disabled={!can(id)} onmousedown={(e) => e.preventDefault()} onclick={() => press(id as "bold")}>{letter}</button>
    {/each}
    <button type="button" class="tb" data-testid="cmd-code" title="Inline code" aria-label="Inline code" aria-pressed={st.code === "on"} class:on={st.code === "on"} disabled={!can("code") || inCell} onmousedown={(e) => e.preventDefault()} onclick={() => press("code")}><Icon name="code" /></button>
  </div>
  <div class="group g2">
    <Menu label="" title="Text colour" icon="textcolor" testid="cmd-color" swatches items={colourItems} disabled={!can("color")} onselect={(v) => mark({ kind: "color", value: v === "none" ? null : v })} />
    <Menu label="" title="Highlight" icon="highlight" testid="cmd-bg" swatches items={bgItems} disabled={!can("bg")} onselect={(v) => mark({ kind: "bg", value: v === "none" ? null : hexOf(v) })} />
    <Popover bind:open={linkOpen} label="Link">
      {#snippet trigger()}
        <button type="button" class="tb" data-testid="cmd-link" title="Link (Ctrl+K)" aria-label="Link" class:on={st.link !== null} disabled={!can("link") || inCell} onmousedown={(e) => e.preventDefault()} onclick={() => (linkOpen = !linkOpen)}><Icon name="link" /></button>
      {/snippet}
      <form class="linkpanel" onsubmit={(e) => (e.preventDefault(), applyLink())}>
        <input class="input" type="url" placeholder="https://…" aria-label="Link address" data-testid="link-address" bind:value={address} />
        <div class="row">
          <button type="submit" class="small primary">Apply</button>
          {#if st.link && /^(https?:|mailto:)/i.test(st.link)}<a class="small" href={st.link} target="_blank" rel="noopener noreferrer">Open</a>{/if}
          <button type="button" class="small" data-testid="link-remove" onclick={() => ((linkOpen = false), send({ type: "setLink", href: null }))}>Remove</button>
        </div>
      </form>
    </Popover>
  </div>
  <div class="group g3">
    <Menu label={blockLabel} title="Block style" testid="cmd-block" items={BLOCKS.map(([v, l]) => ({ value: v, label: l, selected: st.block === v }))} disabled={!can("block")} onselect={(v) => send({ type: "setBlock", kind: v as "h1" })} />
    <Menu label={listLabel} title="List" testid="cmd-list" items={LISTS.map(([v, l]) => ({ value: v, label: l, selected: st.list === v }))} disabled={!can("list")} onselect={(v) => send({ type: "setList", kind: v as "bullet" })} />
    <Menu label="Insert" title="Insert" testid="cmd-insert" items={INSERTS.map(([v, l]) => ({ value: v, label: l }))} disabled={!can("insert")} onselect={(v) => (v === "photo" ? onphoto() : send({ type: "insertBlock", what: v as "table" }))} />
  </div>
  <div class="group g5">
    <Popover bind:open={stylesOpen} label="Styles" wide>
      {#snippet trigger()}
        <button type="button" class="tb text" data-testid="cmd-styles" title="Styles: use a saved style, or save this one" disabled={!can("styles")} onmousedown={(e) => e.preventDefault()} onclick={() => (stylesOpen = !stylesOpen)}>{matching}</button>
      {/snippet}
      <div class="styles">
        <button type="button" class="item" data-testid="menu-item" data-value="reset" onmousedown={(e) => e.preventDefault()} onclick={() => ((stylesOpen = false), send({ type: "applyStyle", style: "reset" }))}>Default (reset)</button>
        {#each savedStyles as s (s.name)}
          <button type="button" class="item" data-testid="menu-item" data-value={s.name} style={previewCss(s, 16)} onmousedown={(e) => e.preventDefault()} onclick={() => ((stylesOpen = false), send({ type: "applyStyle", style: s }))}>{s.name}</button>
        {:else}
          <p class="none">No styles yet. Set up some text, then save it here.</p>
        {/each}
        <form class="save" onsubmit={(e) => (e.preventDefault(), saveStyle())}>
          <input class="input" placeholder="Name this style" maxlength="40" aria-label="Style name" data-testid="style-name" bind:value={styleName} />
          <button type="submit" class="small primary" data-testid="style-save">Save</button>
        </form>
      </div>
    </Popover>
  </div>
  <div class="group g6">
    <button type="button" class="tb letter" data-testid="cmd-invisibles" title={invisibles ? "Hide spaces, tabs and line ends" : "Show spaces, tabs and line ends"} aria-label="Show invisible characters" aria-pressed={invisibles} class:on={invisibles} onmousedown={(e) => e.preventDefault()} onclick={() => oninvisibles?.()}>¶</button>
  </div>
</div>

<style>
  /* A floating bar of soft coloured capsules, one colour per group. A button lifts to white on
     hover and fills with its group's colour when it is on. */
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2);
    margin: var(--s-2) var(--s-3) 0;
    padding: var(--s-2);
    border: 1px solid var(--rule);
    border-radius: var(--r-lg);
    background: var(--surface);
    box-shadow: var(--shadow-1);
  }
  .group {
    --g: var(--group-0);
    --g-soft: var(--group-0-soft);
    --tb-hover: var(--surface);
    --tb-ink: var(--g);
    display: flex;
    align-items: center;
    gap: var(--s-0);
    padding: var(--s-0);
    border-radius: var(--r-md);
    background: var(--g-soft);
  }
  .g1 {
    --g: var(--group-1);
    --g-soft: var(--group-1-soft);
  }
  .g2 {
    --g: var(--group-2);
    --g-soft: var(--group-2-soft);
  }
  .g3 {
    --g: var(--group-3);
    --g-soft: var(--group-3-soft);
  }
  .g4 {
    --g: var(--group-4);
    --g-soft: var(--group-4-soft);
  }
  .g5 {
    --g: var(--group-5);
    --g-soft: var(--group-5-soft);
  }
  .g6 {
    --g: var(--group-6);
    --g-soft: var(--group-6-soft);
  }
  .tb {
    display: grid;
    place-items: center;
    min-width: 2rem;
    height: 2rem;
    padding: 0 var(--s-1);
    border: 0;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--ink);
    font-weight: 600;
    cursor: pointer;
    transition:
      background-color 0.12s ease,
      color 0.12s ease,
      transform 0.08s ease;
  }
  .tb:hover:not(:disabled) {
    background: var(--surface);
    color: var(--g);
    box-shadow: var(--shadow-1);
  }
  .tb:active:not(:disabled) {
    transform: scale(0.9);
  }
  .tb:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .tb.on,
  .tb.on:hover:not(:disabled) {
    background: var(--g);
    color: var(--accent-ink);
    box-shadow: var(--shadow-1);
  }
  @media (prefers-reduced-motion: reduce) {
    .tb {
      transition: none;
    }
    .tb:active:not(:disabled) {
      transform: none;
    }
  }
  .tb.text {
    padding: 0 var(--s-2);
    font-size: var(--text-sm);
    max-width: 10rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .letter {
    font-family: var(--font-display);
    font-size: var(--text-md);
  }
  .bold {
    font-weight: 800;
  }
  .italic {
    font-style: italic;
  }
  .underline {
    text-decoration: underline;
  }
  .strike {
    text-decoration: line-through;
  }
  .sizebox {
    width: 2.75rem;
    height: 2rem;
    border: 0;
    border-radius: var(--r-sm);
    background: var(--surface);
    color: var(--g);
    text-align: center;
    font-size: var(--text-sm);
    font-weight: 700;
  }
  .input {
    min-height: 2rem;
    padding: 0 var(--s-2);
    border: 1px solid var(--rule);
    border-radius: var(--r-sm);
    background: var(--surface);
    width: 100%;
  }
  .linkpanel,
  .styles {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .row,
  .save {
    display: flex;
    gap: var(--s-2);
    align-items: center;
  }
  .small {
    padding: var(--s-1) var(--s-2);
    border: 1px solid var(--rule);
    border-radius: var(--r-sm);
    background: var(--surface);
    color: var(--ink);
    font-size: var(--text-sm);
    text-decoration: none;
    cursor: pointer;
  }
  .primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-ink);
  }
  .item {
    padding: var(--s-1) var(--s-2);
    border: 0;
    border-radius: var(--r-sm);
    background: transparent;
    text-align: left;
    cursor: pointer;
  }
  .item:hover {
    background: var(--accent-soft);
  }
  .none {
    color: var(--ink-soft);
    font-size: var(--text-sm);
  }
  @media (max-width: 640px) {
    .toolbar {
      margin: var(--s-1) var(--s-2) 0;
      padding: var(--s-1);
      gap: var(--s-1);
    }
  }
</style>
