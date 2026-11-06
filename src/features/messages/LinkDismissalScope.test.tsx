// @vitest-environment jsdom
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "nostr-tools/utils";
import { afterEach, assert, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useSyncExternalStore, type ComponentProps } from "react";
import { ConversationPresentation } from "../conversation/ConversationPresentation";
import type { LinkRenderer } from "../conversation/contracts";
import { eventDto, type RelayEvent } from "../relay/events";
import { createRelaySession } from "../relay/session";
import {
  bounds,
  keypair,
  message,
  metadata,
  roster,
  signed,
  type Key,
} from "../relay/testing";
import { MessageMarkdown } from "./MessageMarkdown";

const url = "https://example.test/a";
const content = `See ${url} and ${url}`;
const sessions: ReturnType<typeof createRelaySession>[] = [];
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const owner of sessions.splice(0)) owner.dispose();
});

type Props = ComponentProps<LinkRenderer["component"]>;
const faces: Props[] = [];
const registry = [
  {
    id: "probe",
    title: "Probe",
    matches: () => true,
    component: (props: Props) => {
      faces.push(props);
      return <span>Probe face</span>;
    },
  },
];
const links = { snapshot: () => registry as never, subscribe: () => () => {} };
const noInline: never[] = [];
const inline = { snapshot: () => noInline, subscribe: () => () => {} };
const extensions = { links, inline } as never;

async function ownerAuth(agent: Key, owner: Key) {
  const condition = "kind=0&created_at<1700000001";
  return [
    "auth",
    owner.pubkey,
    condition,
    bytesToHex(
      schnorr.sign(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(
              `nostr:agent-auth:${agent.pubkey}:${condition}`,
            ),
          ),
        ),
        owner.secret,
      ),
    ),
  ];
}

type Author = "viewer" | "agent" | "stranger";
type Evidence = "viewer" | "other" | "none" | "forged";

async function fixture(author: Author, evidence: Evidence = "none", count = 1) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const viewer = keypair(),
    relay = keypair(),
    agent = keypair(),
    stranger = keypair(),
    other = keypair();
  const writer = author === "viewer" ? viewer : agent;
  const authorKey = author === "stranger" ? stranger : writer;
  const originals = Array.from({ length: count }, (_, index) =>
    message(authorKey, "room", content, 1700000000 + index),
  );
  const original = originals[0];
  assert.exists(original);
  const attested =
    evidence === "viewer"
      ? await ownerAuth(agent, viewer)
      : evidence === "other"
        ? await ownerAuth(agent, other)
        : evidence === "forged"
          ? [
              "auth",
              viewer.pubkey,
              "kind=0&created_at<1700000001",
              "0".repeat(128),
            ]
          : undefined;
  let agentProfile: RelayEvent = eventDto(
    signed(agent, {
      kind: 0,
      content: JSON.stringify({ name: "Test agent" }),
      tags: attested ? [attested] : [],
    }),
  );
  const published: RelayEvent[] = [];
  const owner = createRelaySession(
    {
      viewer: viewer.pubkey,
      relayAuthor: relay.pubkey,
      media: () => undefined,
      async query(filters) {
        const filter = filters[0];
        assert.exists(filter);
        if (filter.kinds?.includes(39000) || filter.kinds?.includes(39002))
          return [
            metadata(relay, "room", "Room"),
            signed(relay, {
              ...roster(relay, "room", [viewer.pubkey]),
              tags: [
                ["d", "room"],
                ["p", viewer.pubkey, "", "member"],
              ],
            }),
          ];
        if (filter.kinds?.includes(0))
          return filter.authors?.includes(agent.pubkey) ? [agentProfile] : [];
        if (filter.kinds?.includes(9))
          return [
            ...originals,
            bounds(relay, "room", "head", {
              has_more: false,
              next_cursor: null,
            }),
          ];
        return [];
      },
      writer: {
        kinds: [9, 40003, 5],
        async sign(template) {
          return signed(viewer, template);
        },
        async publish(event) {
          published.push(event);
        },
      },
    },
    {
      readStateFloor: () => 0,
      outboxStorage: { load: () => [], save() {} },
      readPublisherLock: async (_signal, work) => work(),
    },
  );
  sessions.push(owner);
  owner.session.channels.ensureList();
  await waitFor(() =>
    expect(owner.session.channels.list().status).toBe("ready"),
  );
  owner.session.channels.ensure("room");
  await waitFor(() =>
    expect(owner.session.channels.window("room").rows).toHaveLength(count),
  );
  function Surface() {
    const { rows } = useSyncExternalStore(
      (listener) => owner.session.channels.subscribeWindow("room", listener),
      () => owner.session.channels.window("room"),
    );
    return (
      <ConversationPresentation value>
        {rows.map((row) => (
          <MessageMarkdown
            key={row.id}
            row={row}
            session={observed}
            extensions={extensions}
            media={() => undefined}
            onOpenLink={() => true}
          />
        ))}
      </ConversationPresentation>
    );
  }
  faces.length = 0;
  const observe = vi.fn(owner.session.observe);
  const observed = Object.create(owner.session, {
    observe: { value: observe },
  }) as typeof owner.session;
  render(<Surface />);
  const ownershipViews = () =>
    observe.mock.calls.filter(([filters]) =>
      filters.some((filter) => filter.kinds?.includes(0)),
    ).length;
  const dismissals = () => faces.slice(-2).map((face) => face.dismiss);
  return {
    owner,
    published,
    original,
    dismissals,
    ownershipViews,
    async revoke() {
      agentProfile = eventDto(
        signed(agent, {
          kind: 0,
          created_at: 1700000001,
          tags: [],
          content: JSON.stringify({ name: "Test agent" }),
        }),
      );
      await owner.session.read([
        { kinds: [0], authors: [agent.pubkey], limit: 1 },
      ]);
    },
    async settled() {
      if (author === "agent")
        await waitFor(() =>
          expect(owner.session.profiles.event?.(agent.pubkey)).toBeDefined(),
        );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    },
  };
}

const edited = (event: RelayEvent | undefined) => {
  assert.exists(event);
  expect(event.kind).toBe(40003);
  return event.content;
};

it("lets an author dismiss each of their own links, one at a time", async () => {
  const h = await fixture("viewer");
  await waitFor(() =>
    expect(h.dismissals()).toEqual([
      expect.any(Function),
      expect.any(Function),
    ]),
  );
  await act(async () => {
    await faces.at(-2)?.dismiss?.();
  });
  await waitFor(() => expect(h.published).toHaveLength(1));
  expect(edited(h.published[0])).toBe(`See <${url}> and ${url}`);
});

it("dismisses the second occurrence without touching the first", async () => {
  const h = await fixture("viewer");
  await waitFor(() => expect(faces.at(-1)?.dismiss).toBeDefined());
  await act(async () => {
    await faces.at(-1)?.dismiss?.();
  });
  await waitFor(() => expect(h.published).toHaveLength(1));
  expect(edited(h.published[0])).toBe(`See ${url} and <${url}>`);
});

it("lets the verified owner of an agent dismiss its links", async () => {
  const h = await fixture("agent", "viewer");
  await waitFor(() => expect(faces.at(-1)?.dismiss).toBeDefined());
  await act(async () => {
    await faces.at(-1)?.dismiss?.();
  });
  await waitFor(() => expect(h.published).toHaveLength(1));
  expect(edited(h.published[0])).toBe(`See ${url} and <${url}>`);
});

it("revokes the owner's dismissal when the agent's evidence is replaced", async () => {
  const h = await fixture("agent", "viewer");
  await waitFor(() => expect(faces.at(-1)?.dismiss).toBeDefined());
  await act(async () => h.revoke());
  await waitFor(() => expect(faces.at(-1)?.dismiss).toBeUndefined());
});

it.each([
  ["a human who is not the author", "stranger", "none"],
  ["an agent whose owner is someone else", "agent", "other"],
  ["an agent with no owner evidence", "agent", "none"],
  ["an agent with a forged attestation", "agent", "forged"],
] as const)("offers no dismissal for %s", async (_name, author, evidence) => {
  const h = await fixture(author, evidence);
  await h.settled();
  await waitFor(() => expect(faces.length).toBeGreaterThan(0));
  expect(faces.every((face) => face.dismiss === undefined)).toBe(true);
  expect(h.published).toHaveLength(0);
});

it("rewrites from the current text when a dismissal follows an edit", async () => {
  const h = await fixture("viewer");
  await waitFor(() => expect(faces.at(-2)?.dismiss).toBeDefined());
  const [stale] = faces.slice(-2);
  await act(async () => {
    h.owner.session.messages.edit(
      h.original.id,
      `${content} again`,
      h.original.id,
    );
  });
  await waitFor(() => expect(h.published).toHaveLength(1));
  await waitFor(() => expect(faces.at(-1)?.dismiss).toBeDefined());
  await waitFor(async () => {
    await act(async () => {
      await stale?.dismiss?.();
    });
    expect(h.published).toHaveLength(2);
  });
  expect(edited(h.published[1])).toBe(`See <${url}> and ${url} again`);
});

it("keeps both dismissals when two follow each other", async () => {
  const h = await fixture("viewer");
  await waitFor(() => expect(faces.at(-2)?.dismiss).toBeDefined());
  const [first, second] = faces.slice(-2);
  await act(async () => {
    await first?.dismiss?.();
  });
  await waitFor(async () => {
    await act(async () => {
      await second?.dismiss?.();
    });
    expect(h.published).toHaveLength(2);
  });
  expect(edited(h.published[0])).toBe(`See <${url}> and ${url}`);
  expect(edited(h.published[1])).toBe(`See <${url}> and <${url}>`);
});

it("rejects a dismissal that starts while another is still being sent", async () => {
  const h = await fixture("viewer");
  await waitFor(() => expect(faces.at(-2)?.dismiss).toBeDefined());
  const [first, second] = faces.slice(-2);
  await act(async () => {
    await first?.dismiss?.();
    await expect(second?.dismiss?.()).rejects.toThrow();
  });
  await waitFor(() => expect(h.published).toHaveLength(1));
  expect(edited(h.published[0])).toBe(`See <${url}> and ${url}`);
});

it("observes no ownership for a human author", async () => {
  const h = await fixture("stranger");
  await h.settled();
  expect(h.ownershipViews()).toBe(0);
});

it("shares one ownership observation across an agent's rows", async () => {
  const h = await fixture("agent", "viewer", 5);
  await waitFor(() => expect(faces.at(-1)?.dismiss).toBeDefined());
  await h.settled();
  expect(faces.length).toBeGreaterThanOrEqual(10);
  expect(h.ownershipViews()).toBe(1);
});
