// SPEC-AGENTS 2.2: a person's agents, for the Account screen. A token is held only from the
// moment it is made until the person closes it; it is never stored.

import type { Agent } from "../../../contract/src/index.ts";
import { api, ApiError } from "../lib/api.ts";
import { session } from "./session.svelte.ts";

const state = $state<{ agents: Agent[]; loaded: boolean; error: string; made: { agent: Agent; token: string } | null; busy: boolean }>({
  agents: [],
  loaded: false,
  error: "",
  made: null,
  busy: false,
});

/** Goes up whenever the store is cleared; an answer asked for before then is thrown away. */
let epoch = 0;

const messageOf =(e: unknown, fallback: string): string => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

export const agents = {
  get list(): Agent[] {
    return state.agents;
  },
  get loaded(): boolean {
    return state.loaded;
  },
  /** Why the last request failed, or "". */
  get error(): string {
    return state.error;
  },
  /** The agent just made, with its token, until `close()`. */
  get made(): { agent: Agent; token: string } | null {
    return state.made;
  },
  get busy(): boolean {
    return state.busy;
  },

  async refresh(): Promise<void> {
    const asked = epoch;
    try {
      const r = await api().agents();
      if (asked !== epoch) return;
      state.agents = r.agents;
      state.loaded = true;
      state.error = "";
    } catch (e) {
      if (asked === epoch) state.error = messageOf(e, "The agents could not be listed.");
    }
  },

  /** Makes a token with this name. True when it was made: `made` then holds it. Not while a
   *  token is still shown: making another would take the first off the screen, and it cannot be
   *  shown again. */
  async make(name: string): Promise<boolean> {
    if (state.busy || state.made) return false;
    state.busy = true;
    state.error = "";
    const asked = epoch;
    try {
      const r = await api().agentMake(name);
      // The session ended while the answer was on its way: the token is not kept, or the next
      // person to log in here would be shown it (review).
      if (asked !== epoch) return false;
      state.made = r;
      state.agents = [...state.agents, r.agent];
      return true;
    } catch (e) {
      if (asked === epoch) state.error = messageOf(e, "The agent could not be made.");
      return false;
    } finally {
      state.busy = false;
    }
  },

  /** Revokes a token: its next request is refused. */
  async revoke(id: string): Promise<boolean> {
    state.error = "";
    try {
      await api().agentRevoke(id);
    } catch (e) {
      // Already gone (revoked in another tab) is as good as revoked.
      if (!(e instanceof ApiError && e.status === 404)) {
        state.error = messageOf(e, "The agent could not be revoked.");
        return false;
      }
    }
    state.agents = state.agents.filter((a) => a.id !== id);
    if (state.made?.agent.id === id) state.made = null;
    return true;
  },

  /** The person has the token: it is forgotten here. */
  close(): void {
    state.made = null;
  },

  /** A password change revoked them all (2.1); and on logout nothing of them stays. */
  clear(): void {
    epoch++;
    state.agents = [];
    state.made = null;
    state.error = "";
    state.loaded = false;
  },
};

// When the session ends (a logout here or in another tab, a 401), the list and any token still
// shown go, so that the next person to log in in this tab never sees them (review).
session.onEnd(() => agents.clear());
