// @vitest-environment jsdom
import { expect, it } from "vitest";
import {
  CountsUnavailable,
  ensureChannel,
  INSTALL_TYPE,
  installCount,
  readCounts,
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
const key = "github.com/octo/notes-plugin";
const other = "github.com/octo/other";
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

it("uses the oldest marketplace channel an owner or admin made", async () => {
  const community = fakeCommunity({
    roster: [
      { pubkey: alice, role: "member" },
      { pubkey: bob, role: "admin" },
      { pubkey: carol, role: "member" },
    ],
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
    id: channel,
  });
  expect(community.create).not.toHaveBeenCalled();
});

it("creates the channel only for an owner or admin", async () => {
  const owner = fakeCommunity();
  await expect(ensureChannel(owner.session)).resolves.toMatchObject({
    creator: alice,
  });
  expect(owner.create).toHaveBeenCalledWith({
    name: "Community plugins",
    description: "Plugin installs and upvotes in this community.",
    visibility: "open",
    labels: ["buzz-marketplace"],
    system: true,
  });
  const member = fakeCommunity({ roster: [{ pubkey: alice, role: "member" }] });
  await expect(ensureChannel(member.session)).rejects.toThrow(
    CountsUnavailable,
  );
  expect(member.create).not.toHaveBeenCalled();
  const open = fakeCommunity({ roster: null });
  await expect(ensureChannel(open.session)).rejects.toThrow(
    "doesn't publish its members",
  );
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

it("reconciles records with what is installed, within a bound", async () => {
  const community = existing();
  await record(community, INSTALL_TYPE, alice, other);
  await record(community, VOTE_TYPE, alice, other);
  const counts = await readCounts(community.session);
  const listings = [
    { key, id: "octo.notes" },
    { key: other, id: "octo.other" },
  ];
  expect(
    reconcile(counts, listings, (id) => id === "octo.notes", true),
  ).toEqual([
    { type: INSTALL_TYPE, key, on: true },
    { type: INSTALL_TYPE, key: other, on: false },
    { type: VOTE_TYPE, key: other, on: false },
  ]);
  expect(reconcile(counts, listings, () => true, true)).toEqual([
    { type: INSTALL_TYPE, key, on: true },
  ]);
  expect(reconcile(counts, listings, () => true, false)).toHaveLength(2);
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
