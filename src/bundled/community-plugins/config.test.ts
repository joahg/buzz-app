import { afterEach, expect, it, vi } from "vitest";
import { bundledPlugins } from "..";
import { communityIndexOrigin, communityPluginsAccess } from "./config";

afterEach(() => vi.unstubAllEnvs());

it("grants network access only to a configured index and GitHub's API", () => {
  expect(communityPluginsAccess("")).toEqual({});
  expect(communityPluginsAccess("https://plugins.example")).toEqual({
    host: {
      networkOrigins: ["https://plugins.example", "https://api.github.com"],
    },
  });
  vi.stubEnv("VITE_BUZZ_COMMUNITY_PLUGIN_INDEX_URL", "https://plugins.example");
  expect(communityIndexOrigin()).toBe("https://plugins.example");
});

it("ships on by default with no access in a build without an index", () => {
  const plugin = bundledPlugins.find(
    ({ manifest }) => manifest.id === "buzz.community-plugins",
  );
  expect(plugin?.enabledByDefault).toBe(true);
  expect(plugin?.manifest.host).toBeUndefined();
});
