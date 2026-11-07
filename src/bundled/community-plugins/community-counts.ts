// Install counts and upvotes kept in the community itself: each member's
// install and upvote is a NIP-AR artifact in one open NIP-CL system channel,
// so only that community's members can read them.
import {
  ARTIFACT_KIND,
  uuidv5,
} from "../../features/agents/agent-config-artifacts";
import type { EventData, ReadFilter } from "../../features/relay/events";
import type { ChannelSummary } from "../../features/relay/contracts";
import type { RelaySession } from "../../features/relay/session";
import type { InstalledPlugin } from "../../features/plugin-inventory/service";

export const MARKETPLACE_LABEL = "buzz-marketplace";
export const INSTALL_TYPE = "buzz.plugin.install";
export const VOTE_TYPE = "buzz.plugin.vote";
export type RecordType = typeof INSTALL_TYPE | typeof VOTE_TYPE;
const PLUGIN_TAG = "plugin";
/** The writer, so one member's own records can be read on their own. */
const MEMBER_TAG = "installer";
/** The session reader's page cap. */
const PAGE = 500;
/** The relay's largest artifact page offset. */
const MAX_OFFSET = 10_000;
/** Records one sync writes; the rest wait for the next. */
export const MAX_RECONCILE = 50;

/** A plugin manifest id, as the plugin manager accepts it. */
export const validPluginId = (id: string) =>
  id.length <= 80 &&
  /^[a-z][a-z0-9.-]*$/.test(id) &&
  !id.split(/[.-]/).some((part) => !part);

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
  id: string,
) => uuidv5(channel, `${type}\n${pubkey}\n${id}`);

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
  const id = tag(event, PLUGIN_TAG);
  if (!id || !validPluginId(id)) return undefined;
  if (tag(event, "d") !== (await recordId(channel, type, event.pubkey, id)))
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

export const installCount = (tally: Tally | undefined, id: string) =>
  tally?.installers.get(id)?.size ?? 0;
export const upvoteCount = (tally: Tally | undefined, id: string) =>
  tally?.voters.get(id)?.size ?? 0;
export const hasRecord = (
  tally: Tally | undefined,
  type: RecordType,
  id: string,
  pubkey: string,
) =>
  !!(type === INSTALL_TYPE ? tally?.installers : tally?.voters)
    ?.get(id)
    ?.has(pubkey);

function capabilities(session: RelaySession) {
  const read = session.snapshotRead;
  const writer = session.configArtifactWriter;
  const findSystemLabeled = session.channels.findSystemLabeled;
  const viewer = session.viewer;
  if (
    !read ||
    !writer ||
    !findSystemLabeled ||
    !viewer ||
    !session.relayAuthor ||
    !session.channelLifecycle.available
  )
    throw new CountsUnavailable("This community can't keep plugin counts.");
  return { read, writer, findSystemLabeled, viewer };
}

/** The community's marketplace channel: the oldest open, unarchived system
 * channel with the marketplace label, whoever made it. A private or archived
 * one is skipped, so the next oldest takes over. */
export async function findChannel(
  session: RelaySession,
  signal?: AbortSignal,
): Promise<ChannelSummary | undefined> {
  const { findSystemLabeled } = capabilities(session);
  const found = await findSystemLabeled(MARKETPLACE_LABEL, {
    consistency: "strong",
    ...(signal ? { signal } : {}),
  });
  return found.find(
    (channel) =>
      channel.channelType === "system" &&
      !channel.private &&
      channel.visibility !== "private" &&
      !channel.archived,
  );
}

const ensuring = new WeakMap<RelaySession, Promise<ChannelSummary>>();

/** Finds the channel, creating it when a complete lookup found none. Any
 * member may; concurrent creators each make one and every client then uses
 * the oldest. */
export function ensureChannel(
  session: RelaySession,
  signal?: AbortSignal,
): Promise<ChannelSummary> {
  const pending = ensuring.get(session);
  if (pending) return pending;
  const run = (async () => {
    const existing = await findChannel(session, signal);
    if (existing) return existing;
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
  })();
  ensuring.set(session, run);
  run.catch(() => {
    if (ensuring.get(session) === run) ensuring.delete(session);
  });
  return run;
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
  await session.channelLifecycle.run("join", channel, signal);
  done.add(channel);
}

export type Source = InstalledPlugin["source"];

const sourceTags = (source: Source | undefined): string[][] =>
  source === undefined
    ? []
    : source === "local"
      ? [["source", "local"]]
      : [
          ["source", source.repository],
          ["path", source.path],
          ...(source.commit ? [["commit", source.commit]] : []),
        ];

const sameSource = (event: EventData, source: Source | undefined) => {
  const want = sourceTags(source);
  return ["source", "path", "commit"].every(
    (name) => tag(event, name) === want.find((t) => t[0] === name)?.[1],
  );
};

/** One of the viewer's own records, as its current revision reads. */
export type OwnRecord = Readonly<{
  type: RecordType;
  id: string;
  on: boolean;
  event: EventData;
}>;

/** The viewer's own current install and upvote records in `channel`. */
export async function readOwn(
  session: RelaySession,
  channel: string,
  signal?: AbortSignal,
): Promise<OwnRecord[]> {
  const { read, viewer } = capabilities(session);
  const records: OwnRecord[] = [];
  for (const type of [INSTALL_TYPE, VOTE_TYPE] as const) {
    for (let offset = 0; offset <= MAX_OFFSET; offset += PAGE) {
      const page = await read(
        [
          {
            kinds: [ARTIFACT_KIND],
            "#h": [channel],
            "#type": [type],
            [`#${MEMBER_TAG}`]: [viewer],
            artifact: "current",
            limit: PAGE,
            ...(offset ? { offset } : {}),
          },
        ],
        { signal },
      );
      for (const event of page) {
        if (event.pubkey !== viewer) continue;
        const on = await recordState(event, channel, type);
        if (on !== undefined)
          records.push({
            type,
            id: tag(event, PLUGIN_TAG) as string,
            on,
            event,
          });
      }
      if (page.length < PAGE) break;
    }
  }
  return records;
}

/** Turns the viewer's install or upvote record for plugin `id` on or off,
 * unless it already reads that way. */
export async function writeRecord(
  session: RelaySession,
  channel: string,
  type: RecordType,
  id: string,
  on: boolean,
  options: Readonly<{
    source?: Source | undefined;
    signal?: AbortSignal | undefined;
  }> = {},
) {
  const { read, writer, viewer } = capabilities(session);
  const signal = options.signal ?? AbortSignal.timeout(20_000);
  if (!validPluginId(id)) throw new Error("Invalid plugin id");
  const d = await recordId(channel, type, viewer, id);
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
  if (
    head?.pubkey === viewer &&
    current === on &&
    (!on || type !== INSTALL_TYPE || sameSource(head, options.source))
  )
    return false;
  if (!head && !on) return false;
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
        [PLUGIN_TAG, id],
        [MEMBER_TAG, viewer],
        ...(on && type === INSTALL_TYPE ? sourceTags(options.source) : []),
        ["op", head ? "update" : "create"],
        ...(head ? [["prev", head.id]] : []),
      ],
    },
    signal,
  );
  await writer.publish(event, signal);
  return true;
}

export type Change = Readonly<{
  type: RecordType;
  id: string;
  on: boolean;
  source?: Source | undefined;
}>;

/** The writes that make the viewer's records match what is installed: an
 * install record per installed plugin, none for the rest, and no upvote
 * without an install. With recording off, every record is withdrawn. At most
 * `MAX_RECONCILE`, installs added before stale ones are withdrawn. */
export function reconcile(
  own: readonly OwnRecord[],
  installed: readonly InstalledPlugin[],
  recording: boolean,
): Change[] {
  const want = new Map(
    recording
      ? installed
          .filter((plugin) => validPluginId(plugin.id))
          .map((plugin) => [plugin.id, plugin.source] as const)
      : [],
  );
  const add: Change[] = [];
  const remove: Change[] = [];
  const recorded = new Map<string, OwnRecord>();
  for (const record of own) {
    if (record.type === INSTALL_TYPE) recorded.set(record.id, record);
    else if (record.on && !want.has(record.id))
      remove.push({ type: VOTE_TYPE, id: record.id, on: false });
  }
  for (const [id, source] of want) {
    const record = recorded.get(id);
    if (!record?.on || !sameSource(record.event, source))
      add.push({ type: INSTALL_TYPE, id, on: true, source });
  }
  for (const [id, record] of recorded)
    if (record.on && !want.has(id))
      remove.push({ type: INSTALL_TYPE, id, on: false });
  return [...add, ...remove].slice(0, MAX_RECONCILE);
}

/** `counts` as it reads after the viewer's record for `id` is written. */
export function withRecord(
  counts: CommunityCounts,
  type: RecordType,
  id: string,
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
    const found = map.get(id) ?? new Set<string>();
    map.set(id, found);
    return found;
  };
  const viewer = counts.viewer;
  if (type === INSTALL_TYPE) {
    if (on) {
      people(installers).add(viewer);
      if (myVotes.has(id)) people(voters).add(viewer);
    } else {
      installers.get(id)?.delete(viewer);
      voters.get(id)?.delete(viewer);
    }
  } else if (on) {
    myVotes.add(id);
    if (installers.get(id)?.has(viewer)) people(voters).add(viewer);
  } else {
    myVotes.delete(id);
    voters.get(id)?.delete(viewer);
  }
  return {
    ...counts,
    myVotes,
    tally: { installers, voters, partial: counts.tally.partial },
  };
}
