// Keeps each member's install records in step with the plugins they have,
// wherever those came from, in whichever community they are signed in to.
import type { InstalledPlugin } from "../../features/plugin-inventory/service";
import type { RelayData } from "../../features/relay/service";
import type { RelaySession } from "../../features/relay/session";
import {
  CountsUnavailable,
  ensureChannel,
  findChannel,
  MAX_RECONCILE,
  readOwn,
  reconcile,
  writeRecord,
} from "./community-counts";

export const RECORD_KEY = "buzz.community-plugins.record.v1";

export type Inventory = Readonly<{
  installed(): readonly InstalledPlugin[] | undefined;
  subscribe(listener: () => void): () => void;
}>;

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export type Recorder = Readonly<{
  recording(): boolean;
  /** Saves the choice, then withdraws or restores the viewer's records. */
  setRecording(on: boolean): Promise<void>;
  /** Brings the current community's records in line now. */
  sync(): Promise<void>;
  /** Called after the recorder wrote records. */
  subscribe(listener: () => void): () => void;
  stop(): void;
}>;

const readyPage = (relay: RelayData): RelaySession | undefined => {
  const snapshot = relay.snapshot();
  return snapshot?.status === "ready" ? snapshot.session : undefined;
};

function defaultStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function createRecorder({
  relay,
  inventory,
  storage = defaultStorage(),
  delayMs = 2_000,
}: Readonly<{
  relay: RelayData;
  inventory: Inventory;
  storage?: Storage | undefined;
  delayMs?: number;
}>): Recorder {
  const listeners = new Set<() => void>();
  const done = new WeakMap<RelaySession, string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let again = false;
  let stopped = false;

  const recording = () => {
    try {
      return storage?.getItem(RECORD_KEY) !== "off";
    } catch {
      return true;
    }
  };

  async function once() {
    const session = readyPage(relay);
    const installed = inventory.installed();
    if (!session || !installed) return;
    const on = recording();
    const fingerprint = JSON.stringify([
      on,
      [...installed].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    ]);
    if (done.get(session) === fingerprint) return;
    try {
      const channel =
        on && installed.length
          ? await ensureChannel(session)
          : await findChannel(session);
      if (!channel) {
        done.set(session, fingerprint);
        return;
      }
      const changes = reconcile(
        await readOwn(session, channel.id),
        installed,
        on,
      );
      let wrote = false;
      for (const change of changes) {
        if (stopped || readyPage(relay) !== session) return;
        if (
          await writeRecord(
            session,
            channel.id,
            change.type,
            change.id,
            change.on,
            {
              source: change.source,
            },
          )
        )
          wrote = true;
      }
      if (changes.length < MAX_RECONCILE) done.set(session, fingerprint);
      else again = true;
      if (wrote) for (const listener of listeners) listener();
    } catch (error) {
      // A community that can't keep counts stays quiet; anything else is
      // tried again on the next change.
      if (error instanceof CountsUnavailable) done.set(session, fingerprint);
    }
  }

  function run(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = once().finally(() => {
      running = undefined;
      if (again && !stopped) {
        again = false;
        schedule();
      }
    });
    return running;
  }

  function schedule() {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => void run(), delayMs);
  }

  const unsubscribe = [
    relay.subscribe(schedule),
    inventory.subscribe(schedule),
  ];
  schedule();

  return {
    recording,
    async setRecording(on) {
      try {
        storage?.setItem(RECORD_KEY, on ? "on" : "off");
      } catch {}
      clearTimeout(timer);
      await running;
      await run();
    },
    sync: async () => {
      clearTimeout(timer);
      await running;
      await run();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      for (const stop of unsubscribe) stop();
      listeners.clear();
    },
  };
}
