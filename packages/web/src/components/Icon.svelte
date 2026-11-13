<script lang="ts">
  // SPEC2 10: the one icon primitive. Strokes use currentColor.
  const PATHS: Record<string, string> = {
    menu: "M4 7h16M4 12h16M4 17h16",
    fold: "M15 6l-6 6 6 6",
    unfold: "M9 6l6 6-6 6",
    plus: "M12 5v14M5 12h14",
    search: "M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM20 20l-4-4",
    trash: "M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12",
    font: "M5 19l6-14h2l6 14M8 13h8",
    styles: "M5 6h14M5 12h10M5 18h6",
    user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20a7 7 0 0 1 14 0",
    close: "M6 6l12 12M18 6L6 18",
    chevron: "M7 10l5 5 5-5",
    link: "M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1",
    code: "M9 8l-4 4 4 4M15 8l4 4-4 4",
    textcolor: "M7 16l5-12 5 12M9 12h6M5 20h14",
    highlight: "M9 15l-3 3h6M8 13l7-9 4 3-7 9z",
    history: "M4 12a8 8 0 1 0 3-6.3M4 4v4h4M12 8v4l3 2",
    settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z",
    save: "M5 5h11l3 3v11H5zM8 5v5h7V5M8 19v-5h8v5",
    note: "M7 4h8l4 4v12H7zM10 12h6M10 16h6",
    pen: "M4 20l4.5-1L19 8.5 15.5 5 5 15.5zM13.5 7l3.5 3.5",
    // A small robot head: something an agent wrote (SPEC-AGENTS 4.1).
    agent: "M12 4v3M6 7h12v11H6zM3 11v4M21 11v4M9.5 11.5v1.5M14.5 11.5v1.5M10 15.5h4",
    check: "M5 12l5 5 9-10",
    warn: "M12 4l9 16H3zM12 10v4M12 17v.5",
  };
  let { name, size = 18, label = "" }: { name: string; size?: number; label?: string } = $props();
</script>

<svg class="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden={label ? undefined : "true"} aria-label={label || undefined} role={label ? "img" : undefined} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d={PATHS[name] ?? ""} />
</svg>

<style>
  .icon {
    flex: none;
    display: block;
  }
</style>
