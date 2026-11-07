import { Service, type Context } from "@deepseek-ai/cordis";
import type { PluginManager } from "../../plugins/manager";
import type { PluginInfo } from "../../plugins/types";

/** The bundled plugin that records installs in each community. */
export const COMMUNITY_PLUGINS = "buzz.community-plugins";

export type InstalledPlugin = Readonly<{
  id: string;
  source:
    | Readonly<{ repository: string; path: string; commit?: string }>
    | "local";
}>;

declare module "@deepseek-ai/cordis" {
  interface Context {
    pluginInventory: PluginInventoryService;
  }
}

/** A repository as members may see it: never with credentials or a query. */
function publicRepository(repository: string) {
  try {
    const url = new URL(repository);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return repository.replace(/^[^@/]+@(?=[^:/]+[:/])/, (user) =>
      user === "git@" ? user : "",
    );
  }
}

export function installedPlugins(
  plugins: readonly PluginInfo[],
): InstalledPlugin[] {
  return plugins.flatMap((plugin) => {
    if (plugin.source !== "external") return [];
    const update = plugin.updateSource;
    const source =
      update && "repository" in update
        ? {
            repository: publicRepository(update.repository),
            path: update.path,
            ...(update.commit ? { commit: update.commit } : {}),
          }
        : ("local" as const);
    return [{ id: plugin.manifest.id, source }];
  });
}

/** Which plugins are installed, for the Community plugins plugin only: another
 * plugin's call throws. */
export class PluginInventoryService extends Service {
  constructor(
    ctx: Context,
    private readonly manager: () => PluginManager,
  ) {
    super(ctx, "pluginInventory");
  }

  private check() {
    if (this.ctx.pluginOwner?.id !== COMMUNITY_PLUGINS)
      throw new Error("Only Buzz's Community plugins plugin reads installs.");
  }

  /** Installed plugins other than Buzz's own, or undefined until the catalog
   * is read. */
  installed(): InstalledPlugin[] | undefined {
    this.check();
    const { configuration } = this.manager().snapshot();
    return configuration.status === "ready"
      ? installedPlugins(configuration.catalog.plugins)
      : undefined;
  }

  subscribe(listener: () => void): () => void {
    this.check();
    const caller = this.ctx;
    const stop = caller.effect(() => this.manager().subscribe(listener));
    return () => void stop();
  }
}
