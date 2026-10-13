// What an agent type reads of an agent's community beyond the agent's own
// handle: the channel a turn is in, the conversation before it, the names of
// the people in it, and the agent's memory. The desktop app reads these
// through the owner's connection to the community; a standalone host reads
// them as the agent. Both give a type the same answers, so the type runs the
// same code in either.
import type { Memory } from "../../buzz-mcp/client";
import type { EventData, ReadFilter, RelayEvent } from "../relay/events";
import type { RelayData } from "../relay/service";

/** The agent's memory entries, and whether some may be missing. */
export type MemoryListing = Readonly<{
  entries: readonly Memory[];
  partial: boolean;
}>;

/** What a turn needs to know of its channel. */
export type ChannelFacts = Readonly<{
  name?: string;
  dm: boolean;
  members: readonly string[];
}>;

export type AgentReads = Readonly<{
  /** The community these reads are of; it changes when the agent's does. */
  scope: string;
  /** The channel as the community lists it, or undefined when unknown. */
  channel(id: string): Promise<ChannelFacts | undefined>;
  read(
    filters: readonly ReadFilter[],
    signal: AbortSignal,
  ): Promise<readonly EventData[]>;
  /** Asks for these people's profiles, so `name` can name them. */
  profiles(pubkeys: readonly string[]): Promise<unknown>;
  /** A person's name, as the channel with these members shows it when
   * given; if known yet. */
  name(pubkey: string, members?: readonly string[]): string | undefined;
  /** A person's signature-verified profile event, once `profiles` read it. */
  profile(pubkey: string): RelayEvent | undefined;
  /** The community's name for a channel, if it lists the channel now. */
  channelName(id: string): string | undefined;
  /** The key the community signs workflow messages with, if known. */
  workflowAuthority(): string | undefined;
  /** The agent's memory entries; `signal` stops the read. */
  memories(signal?: AbortSignal): Promise<readonly Memory[]>;
  /** The agent's memory, read without holding a view; `partial` when the
   * entries may be incomplete. `signal` stops the read. */
  memoryListing(signal: AbortSignal): Promise<MemoryListing>;
}>;

/** The reads of the owner's connection to the agent's community, while it is
 * ready; undefined otherwise. Memory is encrypted to the owner, so the owner's
 * session reads it without the agent's key. */
export function ownerReads(
  relay: RelayData | undefined,
  pubkey: string,
): AgentReads | undefined {
  const snapshot = relay?.snapshot();
  if (snapshot?.status !== "ready") return undefined;
  const { session } = snapshot;
  return Object.freeze({
    scope: snapshot.scope ?? "",
    channel: async (id: string) => {
      const summary =
        session.channels.list().channels.find((item) => item.id === id) ??
        session.channels.get?.(id);
      return summary
        ? {
            ...(summary.name ? { name: summary.name } : {}),
            dm: summary.channelType === "dm",
            members: summary.members ?? [],
          }
        : undefined;
    },
    read: (filters: readonly ReadFilter[], signal: AbortSignal) =>
      session.read(filters, { signal }),
    profiles: (pubkeys: readonly string[]) =>
      session.profiles.ensure(pubkeys, "foreground"),
    name: (person: string, members?: readonly string[]) =>
      session.names.resolve(person, undefined, members) ??
      session.profiles.snapshot().get(person)?.name ??
      undefined,
    profile: (person: string) => session.profiles.event?.(person),
    channelName: (id: string) =>
      session.channels.list().channels.find((item) => item.id === id)?.name,
    workflowAuthority: () => session.workflowAuthority,
    memoryListing: (signal: AbortSignal) =>
      session.agentMemories.read(pubkey, signal),
    memories: async (signal?: AbortSignal) => {
      signal?.throwIfAborted();
      const view = session.agentMemories.open(pubkey);
      // Stopping the read disposes the view, which ends its refresh.
      let stop!: (reason: unknown) => void;
      const stopped = new Promise<never>((_, reject) => {
        stop = reject;
      });
      const abort = () => {
        stop(signal?.reason);
        view.dispose();
      };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        await Promise.race([view.refresh(), stopped]);
        const { status, listing } = view.snapshot();
        if (status !== "ready" || !listing)
          throw new Error(`Memory unavailable (${status})`);
        return listing.entries;
      } finally {
        signal?.removeEventListener("abort", abort);
        view.dispose();
      }
    },
  });
}
