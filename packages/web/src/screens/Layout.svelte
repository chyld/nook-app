<script lang="ts">
  // SPEC2 9.1, 9.3: `/` and `/n/<id>` share a layout: the sidebar on the left and the screen on
  // the right. Under 640 pixels the sidebar is the whole home screen; over a note it is a full
  // sheet, opened by the header's notes button. At home its fold button shows the welcome and
  // the drafts found, and the welcome's notes button brings the sidebar back.
  import type { Route } from "../lib/router.svelte.ts";
  import { prefs } from "../stores/prefs.svelte.ts";
  import Sidebar from "./Sidebar.svelte";
  import Home from "./Home.svelte";
  import EditorScreen from "./EditorScreen.svelte";
  import DrawingScreen from "./DrawingScreen.svelte";

  let { route }: { route: Route } = $props();
  // A note or a drawing (SPEC-DRAWINGS 6): the same layout.
  const noteId = $derived(route.name === "note" || route.name === "drawing" ? route.id : null);
  const isDrawing = $derived(route.name === "drawing");
  let narrow = $state(typeof matchMedia !== "undefined" && matchMedia("(max-width: 640px)").matches);
  $effect(() => {
    const mq = matchMedia("(max-width: 640px)");
    const f = () => (narrow = mq.matches);
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  });
  /** Under 640 pixels, at home: the sidebar folded away to show the welcome (not kept). */
  let homeFolded = $state(false);
  $effect(() => {
    void noteId;
    homeFolded = false;
  });
  const showSide = $derived(narrow ? (noteId === null ? !homeFolded : prefs.sheet) : !prefs.folded);
  /** The sheet open over a note: the note under it cannot be reached. */
  const covered = $derived(narrow && noteId !== null && prefs.sheet);
  function fold() {
    if (narrow && noteId === null) homeFolded = true;
    else if (narrow) prefs.setSheet(false);
    else prefs.setFolded(true);
  }
  function toggleSidebar() {
    if (narrow && noteId === null) homeFolded = !homeFolded;
    else if (narrow) prefs.setSheet(!prefs.sheet);
    else prefs.setFolded(!prefs.folded);
  }
</script>

<div class="layout" class:narrow class:sheet={covered}>
  {#if showSide}
    <div class="side"><Sidebar openId={noteId} onfold={fold} /></div>
  {/if}
  <div class="screen" class:hidden={narrow && noteId === null && showSide} inert={covered}>
    {#if noteId}
      {#key `${route.name}:${noteId}`}
        {#if isDrawing}
          <DrawingScreen id={noteId} ontoggle={toggleSidebar} />
        {:else}
          <EditorScreen id={noteId} ontoggle={toggleSidebar} />
        {/if}
      {/key}
    {:else}
      <Home ontoggle={toggleSidebar} sidebarShown={showSide} />
    {/if}
  </div>
</div>

<style>
  .layout {
    display: flex;
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
  }
  .side {
    flex: none;
    width: 19rem;
    height: 100%;
  }
  .screen {
    flex: 1;
    min-width: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--surface);
  }
  .narrow .side {
    width: 100%;
  }
  .narrow.sheet .side {
    position: fixed;
    inset: 0;
    z-index: var(--z-sheet);
  }
  .hidden {
    display: none;
  }
</style>
