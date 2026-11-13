<script lang="ts">
  // SPEC2 9.1: change password, log out, the last backup time (a warning when over two days old).
  import { session } from "../stores/session.svelte.ts";
  import { toasts } from "../stores/toasts.svelte.ts";
  import { drafts } from "../stores/drafts.svelte.ts";
  import { agents } from "../stores/agents.svelte.ts";
  import { AGENT_BASE, LIMITS } from "../../../contract/src/index.ts";
  import Button from "../components/Button.svelte";
  import Field from "../components/Field.svelte";

  let current = $state("");
  let next = $state("");
  let error = $state("");
  $effect(() => {
    void session.check().catch(() => {});
  });

  // SPEC-AGENTS 2.2: the person's agents. Each row keeps showing its token, with the guide's
  // address above them (the owner's choice, 2026-11-13).
  let agentName = $state("");
  /** What was copied last: an agent's id, or "guide". */
  let copied = $state("");
  $effect(() => {
    void agents.refresh();
  });
  const guide = `${location.origin}${AGENT_BASE}`;
  const when = (t: string | null) => (t ? new Date(t).toLocaleString() : "never");

  async function makeAgent(e: Event) {
    e.preventDefault();
    copied = "";
    if (await agents.make(agentName)) agentName = "";
  }
  /** Copies a text; `what` names the element that shows it, to select when the browser refuses. */
  async function copy(text: string, what: string, el: HTMLElement | null) {
    try {
      await navigator.clipboard.writeText(text);
      copied = what;
    } catch {
      // The browser refused: the text is on the screen, selected, to copy by hand.
      if (el) getSelection()?.selectAllChildren(el);
      toasts.push("The browser did not copy it. It is selected: copy it by hand.", "warn");
    }
  }
  const shownIn = (e: Event, testid: string): HTMLElement | null => ((e.currentTarget as HTMLElement).closest("li, .guide")?.querySelector<HTMLElement>(`[data-testid="${testid}"]`) ?? null);
  async function revokeAgent(id: string, name: string) {
    if (!(await toasts.confirm(`Revoke “${name}”? Its token stops working at once. What it wrote stays.`, { ok: "Revoke", danger: true }))) return;
    await agents.revoke(id);
  }
  const old = $derived(session.lastBackup === null || Date.now() - Date.parse(session.lastBackup) > 2 * 24 * 3600 * 1000);

  async function change(e: Event) {
    e.preventDefault();
    error = "";
    if ([...next].length < 5) {
      error = "A password has at least 5 characters.";
      return;
    }
    try {
      await session.changePassword(current, next);
      current = next = "";
      // SPEC-AGENTS 2.1: the change revoked every agent's token.
      const had = agents.list.length;
      agents.clear();
      void agents.refresh();
      toasts.push(had ? "Password changed. Your other sessions have ended and your agents' tokens are revoked." : "Password changed. Your other sessions have ended.", "info");
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
    <Field label="New password" type="password" autocomplete="new-password" hint="At least 5 characters." bind:value={next} data-testid="password-new" required />
    {#if agents.list.length}<p class="note" data-testid="password-revokes">Changing your password also revokes your agents' tokens.</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div><Button variant="primary" type="submit" data-testid="password-submit">Change password</Button></div>
  </form>
  <section class="card" data-testid="agents" aria-labelledby="agents-title">
    <h2 id="agents-title">Agents</h2>
    <p class="note">An agent is a program you give a token to. With it, the program can list, read, create and save your notes and drawings. It cannot delete anything.</p>
    <div class="guide">
      <span class="label">The guide to give an agent, with its token</span>
      <div class="row">
        <code class="token" data-testid="agent-guide">{guide}</code>
        <Button small data-testid="agent-guide-copy" onclick={(e) => copy(guide, "guide", shownIn(e, "agent-guide"))}>{copied === "guide" ? "Copied" : "Copy"}</Button>
      </div>
    </div>
    {#if agents.list.length}
      <ul class="agents">
        {#each agents.list as a (a.id)}
          <li data-testid="agent-row" data-name={a.name}>
            <div class="top">
              <span class="name">{a.name}</span>
              <Button small data-testid="agent-revoke" onclick={() => revokeAgent(a.id, a.name)}>Revoke</Button>
            </div>
            {#if a.token}
              <div class="row">
                <code class="token" data-testid="agent-token">{a.token}</code>
                <Button small variant="primary" data-testid="agent-copy" onclick={(e) => copy(a.token ?? "", a.id, shownIn(e, "agent-token"))}>{copied === a.id ? "Copied" : "Copy"}</Button>
              </div>
            {:else}
              <span class="times" data-testid="agent-no-token">This agent was made before tokens were kept, so its token cannot be shown. It still works. Revoke it and make a new one to see the token here.</span>
            {/if}
            <span class="times">Made {when(a.created)} · last used {when(a.used)}</span>
          </li>
        {/each}
      </ul>
    {:else if agents.loaded}
      <p class="note">You have no agents.</p>
    {/if}
    <form class="row" onsubmit={makeAgent}>
      <Field label="Name of a new agent" hint="For example: Claude on the laptop." maxlength={LIMITS.agentName} bind:value={agentName} data-testid="agent-name" required />
      <Button type="submit" data-testid="agent-make" disabled={agents.busy || agentName.trim() === ""}>Make a token</Button>
    </form>
    {#if agents.error}<p class="error" role="alert" data-testid="agent-error">{agents.error}</p>{/if}
  </section>
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
  .note {
    color: var(--ink-soft);
    font-size: var(--text-sm);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: var(--s-2);
  }
  .guide {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  .guide .label {
    font-size: var(--text-sm);
    font-weight: 600;
  }
  /* A token or the guide's address with its Copy button: the text takes the room, and breaks. */
  .guide .row,
  .agents .row {
    flex-wrap: nowrap;
    align-items: center;
  }
  .token {
    flex: 1;
    min-width: 0;
    padding: var(--s-2);
    border-radius: var(--r-sm);
    background: var(--surface-2);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
    user-select: all;
  }
  .agents {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .agents li {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    padding: var(--s-3);
    border: 1px solid var(--rule);
    border-radius: var(--r-md);
  }
  .agents .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
  }
  .agents .name {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .agents .times {
    color: var(--ink-soft);
    font-size: var(--text-xs);
  }
</style>
