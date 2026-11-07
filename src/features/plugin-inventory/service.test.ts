import { Context } from "@deepseek-ai/cordis";
import { expect, it, vi } from "vitest";
import type { PluginManager } from "../../plugins/manager";
import type { PluginInfo } from "../../plugins/types";
import {
  COMMUNITY_PLUGINS,
  installedPlugins,
  PluginInventoryService,
} from "./service";

const plugin = (
  id: string,
  source: PluginInfo["source"],
  updateSource?: PluginInfo["updateSource"],
) =>
  ({
    manifest: { id },
    source,
    enabled: true,
    revision: "r",
    previous: null,
    reloadable: false,
    error: null,
    ...(updateSource !== undefined ? { updateSource } : {}),
  }) as PluginInfo;

it("lists installed plugins other than Buzz's own, with where they came from", () => {
  expect(
    installedPlugins([
      plugin("buzz.huddles", "bundled"),
      plugin("octo.notes", "external", {
        repository: "https://user:secret@github.com/octo/notes.git?x=1#y",
        reference: "main",
        path: "plugin",
        commit: "c".repeat(40),
      }),
      plugin("octo.ssh", "external", {
        repository: "git@github.com:octo/ssh.git",
        reference: "main",
        path: "",
      }),
      plugin("octo.folder", "external", { root: "/Users/me/src", path: "x" }),
      plugin("octo.zip", "external", null),
    ]),
  ).toEqual([
    {
      id: "octo.notes",
      source: {
        repository: "https://github.com/octo/notes.git",
        path: "plugin",
        commit: "c".repeat(40),
      },
    },
    {
      id: "octo.ssh",
      source: { repository: "git@github.com:octo/ssh.git", path: "" },
    },
    { id: "octo.folder", source: "local" },
    { id: "octo.zip", source: "local" },
  ]);
});

it("hands the installed set only to the Community plugins plugin", async () => {
  const root = new Context();
  const listeners = new Set<() => void>();
  let configuration: unknown = { status: "loading" };
  const manager = {
    snapshot: () => ({ configuration }),
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  } as unknown as PluginManager;
  new PluginInventoryService(root, () => manager);
  const as = (id: string) =>
    root.extend({ pluginOwner: { id, revision: "bundled" } });
  const inventory = as(COMMUNITY_PLUGINS).pluginInventory;
  expect(inventory.installed()).toBeUndefined();
  configuration = {
    status: "ready",
    catalog: { plugins: [plugin("octo.notes", "external", null)] },
  };
  expect(inventory.installed()).toEqual([
    { id: "octo.notes", source: "local" },
  ]);
  const listener = vi.fn();
  const stop = inventory.subscribe(listener);
  for (const notify of listeners) notify();
  expect(listener).toHaveBeenCalledTimes(1);
  stop();
  expect(listeners.size).toBe(0);
  expect(() => as("example.page").pluginInventory.installed()).toThrow(
    /Community plugins/,
  );
  expect(() => root.pluginInventory.subscribe(() => {})).toThrow();
  await root.fiber.dispose();
});
