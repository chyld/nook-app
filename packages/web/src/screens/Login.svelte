<script lang="ts">
  import Logo from "../components/Logo.svelte";
  // SPEC2 9.1: log in. No sign-up: accounts are made by an admin command.
  import { session } from "../stores/session.svelte.ts";
  import { ApiError } from "../lib/api.ts";
  import Button from "../components/Button.svelte";
  import Field from "../components/Field.svelte";
  let username = $state("");
  let password = $state("");
  let error = $state("");
  let busy = $state(false);
  async function submit(e: Event) {
    e.preventDefault();
    if (busy) return;
    error = "";
    busy = true;
    try {
      await session.login(username.trim(), password);
      password = "";
    } catch (err) {
      error = err instanceof ApiError ? err.message : "The server could not be reached.";
    } finally {
      busy = false;
    }
  }
</script>

<main class="login">
  <form class="card" onsubmit={submit}>
    <div class="brand"><Logo size={30} /> Nook</div>
    <h1>Log in</h1>
    <Field label="Username" bind:value={username} autocomplete="username" autocapitalize="none" spellcheck={false} data-testid="login-username" required />
    <Field label="Password" type="password" bind:value={password} autocomplete="current-password" data-testid="login-password" required />
    {#if error}<p class="error" role="alert" data-testid="login-error">{error}</p>{/if}
    <Button variant="primary" type="submit" disabled={busy} data-testid="login-submit">Log in</Button>
  </form>
</main>

<style>
  .login {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: var(--s-4);
  }
  .card {
    width: min(22rem, 100%);
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    padding: var(--s-6) var(--s-5);
    border: 1px solid var(--rule);
    border-radius: var(--r-lg);
    background: var(--surface);
    box-shadow: var(--shadow-1);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-family: var(--font-display);
    font-size: var(--text-lg);
    font-weight: 750;
  }
  h1 {
    font-family: var(--font-display);
    font-size: var(--text-xl);
  }
  .error {
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-md);
    background: var(--danger-soft);
    color: var(--danger);
    font-size: var(--text-sm);
  }
</style>
