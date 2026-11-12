<script lang="ts">
  // SPEC2 9.1: the screens, by address.
  import { onMount } from "svelte";
  import { router } from "./lib/router.svelte.ts";
  import { session } from "./stores/session.svelte.ts";
  import { fonts } from "./stores/fonts.svelte.ts";
  import { library } from "./stores/library.svelte.ts";
  import { editor } from "./stores/editor.svelte.ts";
  import Toast from "./components/Toast.svelte";
  import Dialog from "./components/Dialog.svelte";
  import Login from "./screens/Login.svelte";
  import Layout from "./screens/Layout.svelte";
  import TopBar from "./screens/TopBar.svelte";
  import History from "./screens/History.svelte";
  import Trash from "./screens/Trash.svelte";
  import Fonts from "./screens/Fonts.svelte";
  import Styles from "./screens/Styles.svelte";
  import Account from "./screens/Account.svelte";
  import NotFound from "./screens/NotFound.svelte";

  const route = $derived(router.route);

  onMount(() => {
    router.start();
    void session.check();
    return session.onEnd(() => {
      editor.close();
      library.reset();
      router.setGuard(null);
      void router.go("/login", { replace: true, force: true });
    });
  });

  $effect(() => {
    if (!session.checked) return;
    if (!session.user && route.name !== "login") void router.go("/login", { replace: true, force: true });
    if (session.user && route.name === "login") void router.go("/", { replace: true, force: true });
  });

  $effect(() => {
    if (session.user) void fonts.load().catch(() => {});
  });
</script>

<svelte:head>
  {#if session.user}
    <link rel="stylesheet" href={`/api/fonts.css?v=${fonts.version}`} />
  {/if}
</svelte:head>

{#if !session.checked}
  <div class="boot" aria-busy="true"></div>
{:else if route.name === "login"}
  <Login />
{:else if session.user}
  {#if route.name === "home" || route.name === "note"}
    <Layout {route} />
  {:else}
    <div class="page">
      <TopBar />
      <main class="main" class:wide={route.name === "fonts"}>
        {#if route.name === "history"}
          <History id={route.id} />
        {:else if route.name === "trash"}
          <Trash />
        {:else if route.name === "fonts"}
          <Fonts />
        {:else if route.name === "styles"}
          <Styles />
        {:else if route.name === "account"}
          <Account />
        {:else}
          <NotFound />
        {/if}
      </main>
    </div>
  {/if}
{/if}
<Toast />
<Dialog />

<style>
  .boot {
    min-height: 100vh;
  }
  .page {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .main {
    flex: 1;
    width: min(56rem, 100%);
    margin: 0 auto;
    padding: var(--s-5) var(--s-4) var(--s-8);
  }
  /* The fonts page uses the whole window, to show as many fonts as fit. */
  .main.wide {
    width: 100%;
  }
</style>
