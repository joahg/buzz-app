import type { LocalAgent, LocalAgents, LocalAgentsSnapshot } from "./local";

/** A settable local-agent list; no keys, relay or runtime. */
export function localAgentsFixture(
  agents: readonly LocalAgent[] = [],
  status: LocalAgentsSnapshot["status"] = "ready",
) {
  let state: LocalAgentsSnapshot = { status, agents };
  const listeners = new Set<() => void>();
  let refreshes = 0;
  /** An error lasts only as long as the update that reports it. */
  const set = (next: Partial<LocalAgentsSnapshot>) => {
    state = {
      status: next.status ?? state.status,
      agents: next.agents ?? state.agents,
      ...(next.error ? { error: next.error } : {}),
    };
    for (const listener of [...listeners]) listener();
  };
  return {
    snapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** A list read again succeeds with the agents it has. */
    refresh: async () => {
      refreshes++;
      set({ status: "ready" });
    },
    set,
    listeners: () => listeners.size,
    refreshes: () => refreshes,
  } satisfies LocalAgents & Record<string, unknown>;
}
