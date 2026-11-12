<script lang="ts">
  // The Nook mark: a rounded tile, a lower-case "n" drawn as an alcove, and a lamp inside it.
  // Its colours are tokens, so it follows the theme. The favicon in `server/src/app.ts` is the
  // same drawing with fixed colours.
  let { size = 30 }: { size?: number } = $props();
</script>

<svg class="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
  <rect class="tile" width="32" height="32" rx="9" />
  <path class="arch" d="M10 24.5V15a6 6 0 0 1 12 0v9.5" />
  <circle class="lamp" cx="16" cy="21" r="2.6" />
</svg>

<style>
  .logo {
    flex: none;
    display: block;
  }
  .tile {
    fill: var(--accent);
  }
  .arch {
    fill: none;
    stroke: var(--accent-ink);
    stroke-width: 3.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .lamp {
    fill: var(--c-yellow);
  }
</style>
