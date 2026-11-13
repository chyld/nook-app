// SPEC-AGENTS 2.2: a person's agents, for the Account screen. Each agent comes with its token,
// which the screen keeps showing (the owner's choice, 2026-11-13).

import type { Agent } from "../../../contract/src/index.ts";
import { api, ApiError } from "../lib/api.ts";
import { session } from "./session.svelte.ts";

const state = $state<{ agents: Agent[]; loaded: boolean; error: string; busy: boolean }>({
  agents: [],
  loaded: false,
  error: "",
  busy: false,
});

/** Goes up whenever the store is cleared; an answer asked for before then is thrown away. */
let epoch = 0;

const messageOf = (e: unknown, fallback: string): string => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

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

  /** Makes an agent with this name. True when it was made: it is then in the list, with its
   *  token. */
  async make(name: string): Promise<boolean> {
    if (state.busy) return false;
    state.busy = true;
    state.error = "";
    const asked = epoch;
    try {
      const r = await api().agentMake(name);
      // The session ended while the answer was on its way: the token is not kept here, or the
      // next person to log in in this tab would be shown it (review).
      if (asked !== epoch) return false;
      state.agents = [...state.agents, { ...r.agent, token: r.agent.token ?? r.token }];
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
    return true;
  },

  /** A password change revoked them all (2.1); and on logout nothing of them stays. */
  clear(): void {
    epoch++;
    state.agents = [];
    state.error = "";
    state.loaded = false;
  },
};

// When the session ends (a logout here or in another tab, a 401), the list and its tokens go, so
// that the next person to log in in this tab never sees them (review).
session.onEnd(() => agents.clear());
