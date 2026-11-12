// SPEC2 9.2: the user, logging in and out.

import type { User } from "../../../contract/src/index.ts";
import { api, ApiError, onUnauthorized } from "../lib/api.ts";
import { drafts } from "./drafts.svelte.ts";

const state = $state<{ user: User | null; checked: boolean; lastBackup: string | null }>({ user: null, checked: false, lastBackup: null });

/** Told when the session ends (a 401, a logout here or in another tab). */
const listeners = new Set<() => void>();

function ended(): void {
  if (!state.user) return;
  state.user = null;
  for (const f of listeners) f();
}

onUnauthorized.handler = ended;

export const session = {
  get user(): User | null {
    return state.user;
  },
  get checked(): boolean {
    return state.checked;
  },
  get lastBackup(): string | null {
    return state.lastBackup;
  },
  onEnd(f: () => void): () => void {
    listeners.add(f);
    return () => listeners.delete(f);
  },
  /** Who am I: at startup, and on the account screen for the backup time. */
  async check(): Promise<void> {
    try {
      const me = await api().me();
      state.user = me.user;
      state.lastBackup = me.lastBackup;
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) throw e;
      state.user = null;
    } finally {
      state.checked = true;
    }
  },
  async login(username: string, password: string): Promise<void> {
    const r = await api().login(username, password);
    state.user = r.user;
    state.checked = true;
    drafts.listenForLogout(() => ended());
  },
  /** Logout removes the user's drafts (after the screen has warned) and tells other tabs. */
  async logout(): Promise<void> {
    const u = state.user;
    try {
      await api().logout();
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) throw e;
    }
    if (u) drafts.removeAll(u.id, true);
    ended();
  },
  async changePassword(current: string, next: string): Promise<void> {
    await api().password(current, next);
  },
};

drafts.listenForLogout(() => ended());
