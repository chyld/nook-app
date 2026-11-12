<script lang="ts">
  import Logo from "../components/Logo.svelte";
  // SPEC2 9.1: the other screens have a top bar with the same links as the sidebar.
  import { router } from "../lib/router.svelte.ts";
  import Icon from "../components/Icon.svelte";
  const links: [string, string, string, string][] = [
    ["/trash", "Trash", "trash", "nav-trash"],
    ["/fonts", "Fonts", "font", "nav-fonts"],
    ["/styles", "Styles", "styles", "nav-styles"],
    ["/account", "Account", "user", "nav-account"],
  ];
</script>

<header class="bar">
  <a class="brand" href="/" onclick={(e) => (e.preventDefault(), router.go("/"))}><Logo size={27} /><span>Nook</span></a>
  <nav class="links">
    {#each links as [href, label, icon, id] (href)}
      <a {href} class:here={router.path === href} data-testid={id} onclick={(e) => (e.preventDefault(), router.go(href))}><Icon name={icon} size={16} /><span>{label}</span></a>
    {/each}
  </nav>
</header>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: var(--s-4);
    padding: var(--s-2) var(--s-4);
    border-bottom: 1px solid var(--rule);
    background: var(--surface);
    flex-wrap: wrap;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    color: var(--ink);
    text-decoration: none;
    font-family: var(--font-display);
    font-weight: 750;
    font-size: var(--text-lg);
  }
  .links {
    display: flex;
    gap: var(--s-1);
    margin-left: auto;
    flex-wrap: wrap;
  }
  .links a {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    padding: var(--s-1) var(--s-2);
    border-radius: var(--r-sm);
    color: var(--ink-soft);
    text-decoration: none;
    font-size: var(--text-sm);
  }
  .links a:hover,
  .links a.here {
    background: var(--side-hover);
    color: var(--ink);
  }
</style>
