// Install counts and upvotes kept in the community itself: each member's
// install and upvote is a NIP-AR artifact in one NIP-CL system channel, so
// only that community's members can read them.
import {
  ARTIFACT_KIND,
  uuidv5,
} from "../../features/agents/agent-config-artifacts";
import {
  managesCommunity,
  readRoster,
} from "../../features/communities/roster";
import type { EventData, ReadFilter } from "../../features/relay/events";
import type { ChannelSummary } from "../../features/relay/contracts";
import { compareChannelAge } from "../../features/relay/channel-labels";
import type { RelaySession } from "../../features/relay/session";
import { parseKey } from "./catalog";

export const MARKETPLACE_LABEL = "buzz-marketplace";
export const INSTALL_TYPE = "buzz.plugin.install";
export const VOTE_TYPE = "buzz.plugin.vote";
export type RecordType = typeof INSTALL_TYPE | typeof VOTE_TYPE;
const PLUGIN_TAG = "plugin";
/** The session reader's page cap. */
const PAGE = 500;
/** The relay's largest artifact page offset. */
const MAX_OFFSET = 10_000;
/** Owners and admins whose channels are looked up; the rest are ignored. */
const MAX_CREATORS = 16;
/** Records one page open brings in line with what is installed. */
export const MAX_RECONCILE = 20;

export type Tally = Readonly<{
  installers: ReadonlyMap<string, ReadonlySet<string>>;
  voters: ReadonlyMap<string, ReadonlySet<string>>;
  /** More records exist than one read takes; counts are lower bounds. */
  partial: boolean;
}>;

export type CommunityCounts = Readonly<{
  channel: string;
  viewer: string;
  tally: Tally;
  /** Plugins the viewer's own upvote record is on for, counted or not. */
  myVotes: ReadonlySet<string>;
}>;

export class CountsUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CountsUnavailable";
  }
}

export const recordId = (
  channel: string,
  type: RecordType,
  pubkey: string,
  key: string,
) => uuidv5(channel, `${type}\n${pubkey}\n${key}`);

const tag = (event: EventData, name: string) =>
  event.tags.find((t) => t[0] === name)?.[1];

/** Whether a current revision is on, or undefined when it isn't a valid
 * record. A record's `d` is derived from its author, so nobody can add one
 * for someone else or more than one per plugin. */
export async function recordState(
  event: EventData,
  channel: string,
  type: RecordType,
): Promise<boolean | undefined> {
  if (
    event.kind !== ARTIFACT_KIND ||
    tag(event, "h") !== channel ||
    tag(event, "type") !== type
  )
    return undefined;
  const key = tag(event, PLUGIN_TAG);
  if (!key || !parseKey(key)) return undefined;
  if (tag(event, "d") !== (await recordId(channel, type, event.pubkey, key)))
    return undefined;
  try {
    const { on } = JSON.parse(event.content) as { on?: unknown };
    return typeof on === "boolean" ? on : undefined;
  } catch {
    return undefined;
  }
}

/** Who has each plugin's record on. */
async function collect(
  events: readonly EventData[],
  channel: string,
  type: RecordType,
) {
  const byKey = new Map<string, Set<string>>();
  for (const event of events) {
    if ((await recordState(event, channel, type)) !== true) continue;
    const key = tag(event, PLUGIN_TAG) as string;
    const people = byKey.get(key) ?? new Set<string>();
    byKey.set(key, people);
    people.add(event.pubkey);
  }
  return byKey;
}

/** Counts each member once per plugin; an upvote counts only from someone who
 * has the plugin installed. */
export async function tally(
  installs: readonly EventData[],
  votes: readonly EventData[],
  channel: string,
  partial = false,
): Promise<Tally> {
  const installers = await collect(installs, channel, INSTALL_TYPE);
  const voters = await collect(votes, channel, VOTE_TYPE);
  for (const [key, people] of voters)
    for (const pubkey of people)
      if (!installers.get(key)?.has(pubkey)) people.delete(pubkey);
  return { installers, voters, partial };
}

export const installCount = (tally: Tally | undefined, key: string) =>
  tally?.installers.get(key)?.size ?? 0;
export const upvoteCount = (tally: Tally | undefined, key: string) =>
  tally?.voters.get(key)?.size ?? 0;
export const hasRecord = (
  tally: Tally | undefined,
  type: RecordType,
  key: string,
  pubkey: string,
) =>
  !!(type === INSTALL_TYPE ? tally?.installers : tally?.voters)
    ?.get(key)
    ?.has(pubkey);

function capabilities(session: RelaySession) {
  const read = session.snapshotRead;
  const writer = session.configArtifactWriter;
  const findLabeled = session.channels.findLabeled;
  const viewer = session.viewer;
  if (!read || !writer || !findLabeled || !viewer || !session.relayAuthor)
    throw new CountsUnavailable("This community can't keep plugin counts.");
  return { read, writer, findLabeled, viewer };
}

/** The community's marketplace channel: the oldest open system channel with
 * the marketplace label that one of its owners or admins created. */
export async function findChannel(
  session: RelaySession,
  signal?: AbortSignal,
): Promise<ChannelSummary | undefined> {
  const { findLabeled } = capabilities(session);
  const roster = await readRoster(session, signal);
  if (!roster)
    throw new CountsUnavailable(
      "This community doesn't publish its members, so it can't keep plugin counts.",
    );
  const creators = roster
    .filter((member) => managesCommunity(member.role))
    .slice(0, MAX_CREATORS)
    .map((member) => member.pubkey);
  const found = await Promise.all(
    creators.map((creator) =>
      findLabeled(
        { creator, label: MARKETPLACE_LABEL },
        { consistency: "strong", ...(signal ? { signal } : {}) },
      ),
    ),
  );
  return found
    .flat()
    .filter(
      (channel) =>
        channel.channelType === "system" &&
        !channel.private &&
        !channel.archived &&
        channel.creator !== undefined &&
        creators.includes(channel.creator),
    )
    .sort(compareChannelAge)[0];
}

/** Finds the channel, creating it only when the viewer manages the
 * community and a complete lookup found none. Concurrent creators each make
 * one; every client then uses the oldest. */
export async function ensureChannel(
  session: RelaySession,
  signal?: AbortSignal,
): Promise<ChannelSummary> {
  const { viewer } = capabilities(session);
  const existing = await findChannel(session, signal);
  if (existing) return existing;
  const roster = await readRoster(session, signal);
  const role = roster?.find((member) => member.pubkey === viewer)?.role;
  if (!managesCommunity(role))
    throw new CountsUnavailable(
      "Plugin counts start once an owner or admin of this community opens Community plugins.",
    );
  await session.channelCreation.create({
    name: "Community plugins",
    description: "Plugin installs and upvotes in this community.",
    visibility: "open",
    labels: [MARKETPLACE_LABEL],
    system: true,
  });
  const created = await findChannel(session, signal);
  if (!created)
    throw new Error("The new Community plugins channel isn't readable yet.");
  return created;
}

async function readAll(
  read: NonNullable<RelaySession["snapshotRead"]>,
  channel: string,
  type: RecordType,
  signal?: AbortSignal,
) {
  const events: EventData[] = [];
  for (let offset = 0; offset <= MAX_OFFSET; offset += PAGE) {
    const filter: ReadFilter = {
      kinds: [ARTIFACT_KIND],
      "#h": [channel],
      "#type": [type],
      artifact: "current",
      limit: PAGE,
      ...(offset ? { offset } : {}),
    };
    const page = await read([filter], { signal });
    events.push(...page);
    if (page.length < PAGE) return { events, partial: false };
  }
  return { events, partial: true };
}

export async function readCounts(
  session: RelaySession,
  signal?: AbortSignal,
): Promise<CommunityCounts> {
  const { read, viewer } = capabilities(session);
  const channel = await ensureChannel(session, signal);
  const [installs, votes] = await Promise.all([
    readAll(read, channel.id, INSTALL_TYPE, signal),
    readAll(read, channel.id, VOTE_TYPE, signal),
  ]);
  const myVotes = new Set<string>();
  for (const [key, people] of await collect(
    votes.events.filter((event) => event.pubkey === viewer),
    channel.id,
    VOTE_TYPE,
  ))
    if (people.has(viewer)) myVotes.add(key);
  return {
    channel: channel.id,
    viewer,
    myVotes,
    tally: await tally(
      installs.events,
      votes.events,
      channel.id,
      installs.partial || votes.partial,
    ),
  };
}

const joined = new WeakMap<RelaySession, Set<string>>();

/** Joins the open channel once per session; joining again is a no-op. */
async function join(
  session: RelaySession,
  channel: string,
  signal?: AbortSignal,
) {
  const done = joined.get(session) ?? new Set<string>();
  joined.set(session, done);
  if (done.has(channel)) return;
  if (!session.channelLifecycle.available)
    throw new CountsUnavailable("This community can't keep plugin counts.");
  await session.channelLifecycle.run("join", channel, signal);
  done.add(channel);
}

/** Turns the viewer's install or upvote record for `key` on or off. */
export async function writeRecord(
  session: RelaySession,
  channel: string,
  type: RecordType,
  key: string,
  on: boolean,
  signal = AbortSignal.timeout(20_000),
) {
  const { read, writer, viewer } = capabilities(session);
  if (!parseKey(key)) throw new Error("Invalid plugin key");
  const d = await recordId(channel, type, viewer, key);
  const [head] = await read(
    [
      {
        kinds: [ARTIFACT_KIND],
        "#h": [channel],
        "#d": [d],
        artifact: "current",
        limit: 1,
      },
    ],
    { signal },
  );
  const current = head && (await recordState(head, channel, type));
  if (head?.pubkey === viewer && current === on) return;
  if (!head && !on) return;
  await join(session, channel, signal);
  const event = await writer.sign(
    {
      kind: ARTIFACT_KIND,
      created_at: Math.floor(Date.now() / 1000),
      content: JSON.stringify({ version: 1, on }),
      tags: [
        ["ar", "1"],
        ["d", d],
        ["h", channel],
        ["type", type],
        ["title", type === INSTALL_TYPE ? "Plugin install" : "Plugin upvote"],
        [PLUGIN_TAG, key],
        ["op", head ? "update" : "create"],
        ...(head ? [["prev", head.id]] : []),
      ],
    },
    signal,
  );
  await writer.publish(event, signal);
}

/** The records to write so the viewer's installs match what is installed:
 * at most `MAX_RECONCILE`, installs added before stale ones are withdrawn. */
export function reconcile(
  counts: CommunityCounts,
  listings: readonly Readonly<{ key: string; id: string }>[],
  installed: (id: string) => boolean,
  recording: boolean,
): Array<{ type: RecordType; key: string; on: boolean }> {
  const add: Array<{ type: RecordType; key: string; on: boolean }> = [];
  const remove: typeof add = [];
  for (const { key, id } of listings) {
    const has = hasRecord(counts.tally, INSTALL_TYPE, key, counts.viewer);
    const voted = counts.myVotes.has(key);
    const want = recording && installed(id);
    if (want && !has) add.push({ type: INSTALL_TYPE, key, on: true });
    if (!want && has) remove.push({ type: INSTALL_TYPE, key, on: false });
    if (!want && voted) remove.push({ type: VOTE_TYPE, key, on: false });
  }
  return [...add, ...remove].slice(0, MAX_RECONCILE);
}

/** `counts` as it reads after the viewer's record for `key` is written. */
export function withRecord(
  counts: CommunityCounts,
  type: RecordType,
  key: string,
  on: boolean,
): CommunityCounts {
  const installers = new Map(
    [...counts.tally.installers].map(([k, people]) => [k, new Set(people)]),
  );
  const voters = new Map(
    [...counts.tally.voters].map(([k, people]) => [k, new Set(people)]),
  );
  const myVotes = new Set(counts.myVotes);
  const people = (map: Map<string, Set<string>>) => {
    const found = map.get(key) ?? new Set<string>();
    map.set(key, found);
    return found;
  };
  const viewer = counts.viewer;
  if (type === INSTALL_TYPE) {
    if (on) {
      people(installers).add(viewer);
      if (myVotes.has(key)) people(voters).add(viewer);
    } else {
      installers.get(key)?.delete(viewer);
      voters.get(key)?.delete(viewer);
    }
  } else if (on) {
    myVotes.add(key);
    if (installers.get(key)?.has(viewer)) people(voters).add(viewer);
  } else {
    myVotes.delete(key);
    voters.get(key)?.delete(viewer);
  }
  return {
    ...counts,
    myVotes,
    tally: { installers, voters, partial: counts.tally.partial },
  };
}
