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

/** An in-memory community: a signed roster, NIP-CL channel lookups and a
 * NIP-AR store holding each `d`'s current revision. */
export function fakeCommunity({
  viewer = "a".repeat(64),
  roster = [{ pubkey: "a".repeat(64), role: "owner" }],
  channels = [] as Array<{ id: string; creator: string; createdAt: number }>,
}: {
  viewer?: string;
  roster?: Array<{ pubkey: string; role: string }> | null;
  channels?: Array<{ id: string; creator: string; createdAt: number }>;
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
  const session = {
    viewer,
    relayAuthor,
    snapshotRead,
    configArtifactWriter: { sign, publish },
    read: vi.fn(async () =>
      roster
        ? [
            {
              id: "r".repeat(64),
              pubkey: relayAuthor,
              kind: 13534,
              created_at: 1,
              content: "",
              sig: "",
              tags: roster.map(({ pubkey, role }) => ["member", pubkey, role]),
            },
          ]
        : [],
    ),
    channels: {
      findLabeled: vi.fn(async ({ creator }: { creator: string }) =>
        made
          .filter((channel) => channel.creator === creator)
          .map((channel) => ({
            id: channel.id,
            name: "Community plugins",
            channelType: "system",
            creator: channel.creator,
            createdAt: channel.createdAt,
            labels: ["buzz-marketplace"],
          })),
      ),
    },
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
  };
}
