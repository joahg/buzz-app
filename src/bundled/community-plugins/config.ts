import type { PluginManifest } from "../../plugins/api";

/** The build's community plugin index origin, or empty when it has none. */
export function communityIndexOrigin(): string {
  return import.meta.env.VITE_BUZZ_COMMUNITY_PLUGIN_INDEX_URL ?? "";
}

/** Keep in step with `bundled_manifests` in crates/plugin-manager/src/lib.rs. */
export function communityPluginsAccess(
  origin: string,
): Pick<PluginManifest, "host"> {
  return origin
    ? { host: { networkOrigins: [origin, "https://api.github.com"] } }
    : {};
}
