import type { PluginModule } from "../../plugins/api";
import type { PluginInstaller } from "../../plugins/installer";
import { communityIndexOrigin } from "./config";
import { CommunityPluginsPage } from "./CommunityPluginsPage";

export const inject = ["pages", "navigation", "host", "relay"];
export const apply: PluginModule["apply"] = (ctx) => {
  const origin = communityIndexOrigin();
  const host = ctx.host;
  const installer = ctx.reflect.get("pluginInstaller") as
    | PluginInstaller
    | undefined;
  const openPluginSettings = () =>
    void ctx.navigation.open({
      version: 1,
      kind: "settings",
      section: "plugins",
    });
  ctx.pages.register({
    id: "community-plugins",
    title: "Community plugins",
    layout: "workspace",
    primary: true,
    component: () => (
      <CommunityPluginsPage
        origin={origin}
        host={host}
        installer={installer}
        relay={ctx.relay}
        openPluginSettings={openPluginSettings}
      />
    ),
  });
};
