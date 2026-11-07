// @vitest-environment jsdom
import { expect, it } from "vitest";
import {
  CountsUnavailable,
  ensureChannel,
  findChannel,
  INSTALL_TYPE,
  installCount,
  MAX_RECONCILE,
  readCounts,
  readOwn,
  reconcile,
  recordId,
  type RecordType,
  upvoteCount,
  VOTE_TYPE,
  withRecord,
  writeRecord,
} from "./community-counts";
import { fakeCommunity } from "./testing";

const alice = "a".repeat(64);
const bob = "b".repeat(64);
const carol = "c".repeat(64);
const key = "octo.notes";
const other = "octo.other";
const channel = "00000001-0000-4000-8000-000000000000";

async function record(
  community: ReturnType<typeof fakeCommunity>,
  type: RecordType,
  pubkey: string,
  pluginKey: string,
  on = true,
  d?: string,
) {
  community.store.put({
    pubkey,
    kind: 45010,
    created_at: 1,
    content: JSON.stringify({ version: 1, on }),
    tags: [
      ["ar", "1"],
      ["d", d ?? (await recordId(channel, type, pubkey, pluginKey))],
      ["h", channel],
      ["type", type],
      ["plugin", pluginKey],
      ["installer", pubkey],
      ["op", "create"],
    ],
  });
}

const existing = () =>
  fakeCommunity({ channels: [{ id: channel, creator: alice, createdAt: 1 }] });

it("counts each member once, and upvotes only from people who installed", async () => {
  const community = existing();
  await record(community, INSTALL_TYPE, alice, key);
  await record(community, INSTALL_TYPE, bob, key);
  await record(community, INSTALL_TYPE, carol, key, false);
  await record(community, VOTE_TYPE, alice, key);
  await record(community, VOTE_TYPE, carol, key);
  await record(community, INSTALL_TYPE, bob, other);
  const counts = await readCounts(community.session);
  expect(counts.channel).toBe(channel);
  expect(installCount(counts.tally, key)).toBe(2);
  expect(upvoteCount(counts.tally, key)).toBe(1);
  expect(installCount(counts.tally, other)).toBe(1);
  expect(counts.myVotes).toEqual(new Set([key]));
});

it("ignores records whose id isn't derived from their author", async () => {
  const community = existing();
  await record(community, INSTALL_TYPE, alice, key);
  for (const n of [1, 2, 3])
    await record(
      community,
      INSTALL_TYPE,
      bob,
      key,
      true,
      `0000000${n}-0000-4000-8000-000000000000`,
    );
  await record(
    community,
    INSTALL_TYPE,
    bob,
    key,
    true,
    await recordId(channel, INSTALL_TYPE, alice, other),
  );
  const counts = await readCounts(community.session);
  expect(installCount(counts.tally, key)).toBe(1);
  expect(installCount(counts.tally, other)).toBe(0);
});

it("uses the oldest open marketplace channel, whoever made it", async () => {
  const community = fakeCommunity({
    channels: [
      {
        id: "00000003-0000-4000-8000-000000000000",
        creator: carol,
        createdAt: 1,
      },
      {
        id: "00000002-0000-4000-8000-000000000000",
        creator: bob,
        createdAt: 5,
      },
      { id: channel, creator: bob, createdAt: 3 },
    ],
  });
  await expect(ensureChannel(community.session)).resolves.toMatchObject({
    id: "00000003-0000-4000-8000-000000000000",
  });
  expect(community.create).not.toHaveBeenCalled();
  expect(community.findSystemLabeled).toHaveBeenCalledWith(
    "buzz-marketplace",
    expect.objectContaining({ consistency: "strong" }),
  );
});

it("skips private and archived marketplace channels", async () => {
  const community = fakeCommunity({
    channels: [
      {
        id: "00000003-0000-4000-8000-000000000000",
        creator: carol,
        createdAt: 1,
        private: true,
      },
      {
        id: "00000002-0000-4000-8000-000000000000",
        creator: bob,
        createdAt: 2,
        archived: true,
      },
      { id: channel, creator: carol, createdAt: 3 },
    ],
  });
  await expect(findChannel(community.session)).resolves.toMatchObject({
    id: channel,
  });
  const none = fakeCommunity({
    channels: [{ id: channel, creator: bob, createdAt: 1, private: true }],
  });
  await expect(ensureChannel(none.session)).resolves.toMatchObject({
    creator: alice,
  });
  expect(none.create).toHaveBeenCalledTimes(1);
});

it("lets any member create the channel, once per session", async () => {
  const member = fakeCommunity({ viewer: carol });
  const [first, second] = await Promise.all([
    ensureChannel(member.session),
    ensureChannel(member.session),
  ]);
  expect(first).toEqual(second);
  expect(first).toMatchObject({ creator: carol });
  expect(member.create).toHaveBeenCalledTimes(1);
  expect(member.create).toHaveBeenCalledWith({
    name: "Community plugins",
    description: "Plugin installs and upvotes in this community.",
    visibility: "open",
    labels: ["buzz-marketplace"],
    system: true,
  });
});

it("degrades quietly without system channels or artifacts", async () => {
  const community = fakeCommunity();
  const session = community.session as unknown as {
    channels: Record<string, unknown>;
    snapshotRead?: unknown;
  };
  delete session.channels.findSystemLabeled;
  await expect(ensureChannel(community.session)).rejects.toThrow(
    CountsUnavailable,
  );
  const noArtifacts = fakeCommunity();
  delete (noArtifacts.session as unknown as { snapshotRead?: unknown })
    .snapshotRead;
  await expect(readCounts(noArtifacts.session)).rejects.toThrow(
    CountsUnavailable,
  );
  expect(noArtifacts.create).not.toHaveBeenCalled();
});

it("joins, creates, updates and skips unchanged records", async () => {
  const community = existing();
  await writeRecord(community.session, channel, INSTALL_TYPE, key, false);
  expect(community.publish).not.toHaveBeenCalled();
  await writeRecord(community.session, channel, INSTALL_TYPE, key, true);
  expect(community.join).toHaveBeenCalledWith(
    "join",
    channel,
    expect.anything(),
  );
  const [created] = community.store.heads();
  expect(created?.tags).toEqual(
    expect.arrayContaining([
      ["type", INSTALL_TYPE],
      ["plugin", key],
      ["op", "create"],
    ]),
  );
  await writeRecord(community.session, channel, INSTALL_TYPE, key, true);
  expect(community.publish).toHaveBeenCalledTimes(1);
  await writeRecord(community.session, channel, INSTALL_TYPE, key, false);
  const [updated] = community.store.heads();
  expect(updated?.tags).toEqual(
    expect.arrayContaining([
      ["op", "update"],
      ["prev", created?.id],
    ]),
  );
  expect(JSON.parse(updated?.content ?? "")).toEqual({ version: 1, on: false });
  expect(community.join).toHaveBeenCalledTimes(1);
});

it("tags installs with where they came from", async () => {
  const community = existing();
  const git = {
    repository: "https://github.com/octo/notes",
    path: "plugin",
    commit: "c".repeat(40),
  };
  await writeRecord(community.session, channel, INSTALL_TYPE, key, true, {
    source: git,
  });
  expect(community.store.heads()[0]?.tags).toEqual(
    expect.arrayContaining([
      ["installer", alice],
      ["source", git.repository],
      ["path", "plugin"],
      ["commit", git.commit],
    ]),
  );
  await writeRecord(community.session, channel, INSTALL_TYPE, key, true, {
    source: git,
  });
  expect(community.publish).toHaveBeenCalledTimes(1);
  await writeRecord(community.session, channel, INSTALL_TYPE, key, true, {
    source: "local",
  });
  const [local] = community.store.heads();
  expect(local?.tags).toContainEqual(["source", "local"]);
  expect(local?.tags.find((t) => t[0] === "path")).toBeUndefined();
  await expect(
    writeRecord(community.session, channel, INSTALL_TYPE, "Not An Id", true),
  ).rejects.toThrow("Invalid plugin id");
});

it("reads only the viewer's own records", async () => {
  const community = existing();
  await record(community, INSTALL_TYPE, alice, key);
  await record(community, VOTE_TYPE, alice, key, false);
  await record(community, INSTALL_TYPE, bob, other);
  await record(
    community,
    INSTALL_TYPE,
    alice,
    other,
    true,
    "00000009-0000-4000-8000-000000000000",
  );
  const own = await readOwn(community.session, channel);
  expect(own.map(({ type, id, on }) => ({ type, id, on }))).toEqual([
    { type: INSTALL_TYPE, id: key, on: true },
    { type: VOTE_TYPE, id: key, on: false },
  ]);
});

it("reconciles records with what is installed, within a bound", async () => {
  const community = existing();
  await record(community, INSTALL_TYPE, alice, other);
  await record(community, VOTE_TYPE, alice, other);
  await record(community, INSTALL_TYPE, alice, "octo.kept");
  const own = await readOwn(community.session, channel);
  expect(
    reconcile(
      own,
      [
        { id: key, source: "local" },
        { id: "octo.kept", source: "local" },
      ],
      true,
    ),
  ).toEqual([
    { type: INSTALL_TYPE, id: key, on: true, source: "local" },
    { type: INSTALL_TYPE, id: "octo.kept", on: true, source: "local" },
    { type: VOTE_TYPE, id: other, on: false },
    { type: INSTALL_TYPE, id: other, on: false },
  ]);
  expect(reconcile(own, [], false)).toEqual([
    { type: VOTE_TYPE, id: other, on: false },
    { type: INSTALL_TYPE, id: other, on: false },
    { type: INSTALL_TYPE, id: "octo.kept", on: false },
  ]);
  const many = Array.from({ length: MAX_RECONCILE + 5 }, (_, n) => ({
    id: `octo.p${n}`,
    source: "local" as const,
  }));
  expect(reconcile([], many, true)).toHaveLength(MAX_RECONCILE);
  expect(reconcile([], [{ id: "Bad Id", source: "local" }], true)).toEqual([]);
});

it("updates counts the way the written record reads back", async () => {
  const community = existing();
  await record(community, INSTALL_TYPE, bob, key);
  const counts = await readCounts(community.session);
  const voted = withRecord(counts, VOTE_TYPE, key, true);
  expect(upvoteCount(voted.tally, key)).toBe(0);
  const installed = withRecord(voted, INSTALL_TYPE, key, true);
  expect(installCount(installed.tally, key)).toBe(2);
  expect(upvoteCount(installed.tally, key)).toBe(1);
  const removed = withRecord(installed, INSTALL_TYPE, key, false);
  expect(installCount(removed.tally, key)).toBe(1);
  expect(upvoteCount(removed.tally, key)).toBe(0);
  expect(upvoteCount(counts.tally, key)).toBe(0);
});
