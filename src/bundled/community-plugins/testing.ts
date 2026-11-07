import { vi } from "vitest";
import type { RelayData } from "../../features/relay/service";
import type { RelaySession } from "../../features/relay/session";
import type { Listing } from "./catalog";

export const listing = (overrides: Partial<Listing> = {}): Listing => ({
  key: "github.com/octo/notes-plugin",
  slug: "github-com--octo--notes-plugin",
  id: "octo.notes",
  name: "Octo notes",
  tagline: "Keep notes beside conversations.",
  category: "productivity",
  author: { github: "octo" },
  official: false,
  source: {
    repository: "https://github.com/octo/notes-plugin",
    ref: "main",
    commit: "a".repeat(40),
  },
  host: {},
  audit: { tier: "low", flags: [], cleared: true },
  ...overrides,
});

export const rawIndex = (plugins: unknown[]) => ({
  schemaVersion: 1,
  generatedAt: "2026-11-06T00:00:00Z",
  plugins,
});

type Event = {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
  sig: string;
};

const first = (event: { tags: string[][] }, name: string) =>
  event.tags.find((t) => t[0] === name)?.[1];

type FakeChannel = {
  id: string;
  creator: string;
  createdAt: number;
  private?: boolean;
  archived?: boolean;
};

/** An in-memory community: NIP-CL system channel lookups and a NIP-AR store
 * holding each `d`'s current revision. */
export function fakeCommunity({
  viewer = "a".repeat(64),
  channels = [] as FakeChannel[],
}: {
  viewer?: string;
  channels?: FakeChannel[];
} = {}) {
  const relayAuthor = "9".repeat(64);
  const heads = new Map<string, Event>();
  let serial = 0;
  const made = [...channels];
  const store = {
    put(event: Omit<Event, "id" | "sig">) {
      const full = {
        ...event,
        id: (++serial).toString(16).padStart(64, "0"),
        sig: "",
      };
      heads.set(`${first(full, "h")}\n${first(full, "d")}`, full);
      return full;
    },
    heads: () => [...heads.values()],
  };
  const matches = (event: Event, filter: Record<string, unknown>) =>
    Object.entries(filter).every(([name, values]) =>
      !name.startsWith("#")
        ? true
        : (values as string[]).includes(first(event, name.slice(1)) ?? ""),
    );
  const snapshotRead = vi.fn(
    async (filters: readonly Record<string, unknown>[]) => {
      const filter = filters[0] ?? {};
      const offset = (filter.offset as number | undefined) ?? 0;
      return store
        .heads()
        .filter((event) => matches(event, filter))
        .slice(offset, offset + (filter.limit as number));
    },
  );
  const sign = vi.fn(
    async (template: Omit<Event, "id" | "pubkey" | "sig">) => ({
      ...template,
      pubkey: viewer,
      id: "",
      sig: "",
    }),
  );
  const publish = vi.fn(async (event: Event) => {
    store.put(event);
    return "";
  });
  const create = vi.fn(async () => {
    const id = `${(made.length + 1).toString().padStart(8, "0")}-0000-4000-8000-000000000000`;
    made.push({ id, creator: viewer, createdAt: 1000 + made.length });
    return id;
  });
  const join = vi.fn(async () => {});
  const findSystemLabeled = vi.fn(async (label: string) =>
    made
      .map((channel) => ({
        id: channel.id,
        name: "Community plugins",
        channelType: "system",
        creator: channel.creator,
        createdAt: channel.createdAt,
        labels: [label === "buzz-marketplace" ? label : "other"],
        ...(channel.private ? { private: true } : {}),
        ...(channel.archived ? { archived: true } : {}),
      }))
      .filter((channel) => channel.labels.includes(label))
      .sort((a, b) => a.createdAt - b.createdAt),
  );
  const session = {
    viewer,
    relayAuthor,
    snapshotRead,
    configArtifactWriter: { sign, publish },
    channels: { findSystemLabeled },
    channelCreation: { create },
    channelLifecycle: { available: true, run: join },
    profiles: { ensure: vi.fn(async () => {}) },
    names: undefined,
  };
  const ready = { status: "ready", generation: 1, session };
  const relay = { snapshot: () => ready, subscribe: () => () => {} };
  return {
    session: session as unknown as RelaySession,
    relay: relay as unknown as RelayData,
    store,
    snapshotRead,
    publish,
    create,
    join,
    made,
    findSystemLabeled,
  };
}

/** A relay whose selected community can be switched, as signing in to
 * another one does. */
export function switchableRelay(
  first: ReturnType<typeof fakeCommunity> | undefined,
) {
  const listeners = new Set<() => void>();
  let current = first;
  const disconnected = { status: "disconnected", generation: 0 };
  const relay = {
    snapshot: () =>
      current ? (current.relay.snapshot() as unknown) : disconnected,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    relay: relay as unknown as RelayData,
    select(next: ReturnType<typeof fakeCommunity> | undefined) {
      current = next;
      for (const listener of listeners) listener();
    },
  };
}
