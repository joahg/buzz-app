import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { RelayData } from "../../features/relay/service";
import type { RelaySession } from "../../features/relay/session";
import {
  type CommunityCounts,
  CountsUnavailable,
  INSTALL_TYPE,
  installCount,
  readCounts,
  reconcile,
  type RecordType,
  upvoteCount,
  VOTE_TYPE,
  withRecord,
  writeRecord,
} from "./community-counts";

export const RECORD_KEY = "buzz.community-plugins.record.v1";

export function recordingEnabled(): boolean {
  try {
    return window.localStorage.getItem(RECORD_KEY) !== "off";
  } catch {
    return false;
  }
}

function saveRecording(on: boolean) {
  try {
    window.localStorage.setItem(RECORD_KEY, on ? "on" : "off");
  } catch {}
}

export type CountsState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "unavailable"; message: string }>
  | Readonly<{ status: "ready"; counts: CommunityCounts }>;

const noRelay = {
  subscribe: () => () => {},
  snapshot: () => undefined,
};

/** The selected community's plugin counts, and the viewer's writes to them. */
export function useCommunityCounts(
  relay: RelayData | undefined,
  listings: readonly Readonly<{ key: string; id: string }>[] | undefined,
  installed: (id: string) => boolean,
  version: number,
) {
  const snapshot = useSyncExternalStore(
    relay?.subscribe ?? noRelay.subscribe,
    relay?.snapshot ?? noRelay.snapshot,
  );
  const session: RelaySession | undefined =
    snapshot?.status === "ready" ? snapshot.session : undefined;
  const [state, setState] = useState<CountsState>({ status: "loading" });
  const [recording, setRecording] = useState(recordingEnabled);
  const latest = useRef<{
    session?: RelaySession | undefined;
    counts?: CommunityCounts | undefined;
  }>({});
  const installedRef = useRef(installed);
  installedRef.current = installed;
  const recordingRef = useRef(recording);
  recordingRef.current = recording;

  const show = useCallback((counts: CommunityCounts) => {
    latest.current.counts = counts;
    setState({ status: "ready", counts });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Refresh reads the counts again.
  useEffect(() => {
    latest.current = { session };
    if (!session) {
      setState({
        status: "unavailable",
        message: "Plugin counts appear once Buzz is connected to a community.",
      });
      return;
    }
    if (!listings) return;
    const controller = new AbortController();
    const { signal } = controller;
    setState({ status: "loading" });
    void (async () => {
      try {
        let counts = await readCounts(session, signal);
        if (signal.aborted) return;
        show(counts);
        for (const change of reconcile(
          counts,
          listings,
          installedRef.current,
          recordingRef.current,
        )) {
          await writeRecord(
            session,
            counts.channel,
            change.type,
            change.key,
            change.on,
          );
          if (signal.aborted || latest.current.session !== session) return;
          counts = withRecord(counts, change.type, change.key, change.on);
          show(counts);
        }
      } catch (error) {
        if (signal.aborted) return;
        if (latest.current.counts) return;
        setState({
          status: "unavailable",
          message:
            error instanceof CountsUnavailable
              ? error.message
              : "Buzz couldn't read this community's plugin counts.",
        });
      }
    })();
    return () => controller.abort();
  }, [session, listings, show, version]);

  const write = useCallback(
    async (type: RecordType, key: string, on: boolean) => {
      const { session: current, counts } = latest.current;
      if (!current || !counts) return false;
      try {
        await writeRecord(current, counts.channel, type, key, on);
      } catch {
        return false;
      }
      if (latest.current.session !== current) return false;
      show(withRecord(latest.current.counts ?? counts, type, key, on));
      return true;
    },
    [show],
  );

  const recordInstall = useCallback(
    (key: string) =>
      recordingRef.current
        ? write(INSTALL_TYPE, key, true)
        : Promise.resolve(false),
    [write],
  );
  const vote = useCallback(
    (key: string, on: boolean) =>
      recordingRef.current ? write(VOTE_TYPE, key, on) : Promise.resolve(false),
    [write],
  );

  /** Turning recording off withdraws every install and upvote the viewer
   * recorded here. */
  const changeRecording = useCallback(
    async (on: boolean) => {
      saveRecording(on);
      setRecording(on);
      recordingRef.current = on;
      const counts = latest.current.counts;
      if (!counts) return;
      if (on) {
        for (const { key, id } of listings ?? [])
          if (installedRef.current(id)) await write(INSTALL_TYPE, key, true);
        return;
      }
      for (const [key, people] of counts.tally.installers)
        if (people.has(counts.viewer)) await write(INSTALL_TYPE, key, false);
      for (const key of counts.myVotes) await write(VOTE_TYPE, key, false);
    },
    [listings, write],
  );

  const counts = state.status === "ready" ? state.counts : undefined;
  return {
    state,
    session,
    recording,
    changeRecording,
    recordInstall,
    vote,
    installs: (key: string) => installCount(counts?.tally, key),
    upvotes: (key: string) => upvoteCount(counts?.tally, key),
    installers: (key: string) => [...(counts?.tally.installers.get(key) ?? [])],
    voted: (key: string) => !!counts?.myVotes.has(key),
    mine: (key: string) =>
      !!counts?.tally.installers.get(key)?.has(counts.viewer),
  };
}

export type CommunityCountsView = ReturnType<typeof useCommunityCounts>;
