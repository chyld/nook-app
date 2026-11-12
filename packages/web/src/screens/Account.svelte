<script lang="ts">
  // SPEC2 9.1: change password, log out, the last backup time (a warning when over two days old).
  import { session } from "../stores/session.svelte.ts";
  import { toasts } from "../stores/toasts.svelte.ts";
  import { drafts } from "../stores/drafts.svelte.ts";
  import Button from "../components/Button.svelte";
  import Field from "../components/Field.svelte";

  let current = $state("");
  let next = $state("");
  let error = $state("");
  $effect(() => {
    void session.check().catch(() => {});
  });
  const old = $derived(session.lastBackup === null || Date.now() - Date.parse(session.lastBackup) > 2 * 24 * 3600 * 1000);

  async function change(e: Event) {
    e.preventDefault();
    error = "";
    if ([...next].length < 12) {
      error = "A password has at least 12 characters.";
      return;
    }
    try {
      await session.changePassword(current, next);
      current = next = "";
      toasts.push("Password changed. Your other sessions have ended.", "info");
    } catch (err) {
      error = err instanceof Error ? err.message : "The password could not be changed.";
    }
  }
  async function logout() {
    const n = session.user ? drafts.list(session.user.id).length : 0;
    if (n > 0 && !(await toasts.confirm(`Logging out removes ${n === 1 ? "one draft" : `${n} drafts`} of unsaved text kept in this browser.`, { ok: "Log out", danger: true }))) return;
    await session.logout();
  }
</script>

<section class="account">
  <h1>Account</h1>
  <p class="who">Logged in as <strong>{session.user?.username}</strong>.</p>
  <div class="backup" class:old>
    {#if session.lastBackup}
      Last backup: {new Date(session.lastBackup).toLocaleString()}{#if old} — over two days ago.{/if}
    {:else}
      No backup has been recorded yet.
    {/if}
  </div>
  <form class="card" onsubmit={change}>
    <h2>Change password</h2>
    <Field label="Current password" type="password" autocomplete="current-password" bind:value={current} data-testid="password-current" required />
    <Field label="New password" type="password" autocomplete="new-password" hint="At least 12 characters." bind:value={next} data-testid="password-new" required />
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div><Button variant="primary" type="submit" data-testid="password-submit">Change password</Button></div>
  </form>
  <div><Button data-testid="logout" onclick={logout}>Log out</Button></div>
</section>

<style>
  .account {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    max-width: 30rem;
  }
  h1 {
    font-family: var(--font-display);
    font-size: var(--text-2xl);
  }
  h2 {
    font-size: var(--text-lg);
  }
  .backup {
    padding: var(--s-3);
    border-radius: var(--r-md);
    background: var(--info-soft);
    font-size: var(--text-sm);
  }
  .backup.old {
    background: var(--warn-soft);
    color: var(--warn-ink);
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    padding: var(--s-4);
    border: 1px solid var(--rule);
    border-radius: var(--r-lg);
  }
  .error {
    color: var(--danger);
    font-size: var(--text-sm);
  }
</style>
