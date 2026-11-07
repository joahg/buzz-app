import type { PluginModule } from "../../plugins/api";
import type { PluginInstaller } from "../../plugins/installer";
import { communityIndexOrigin } from "./config";
import { CommunityPluginsPage } from "./CommunityPluginsPage";
import { createRecorder } from "./recorder";

export const inject = [
  "pages",
  "navigation",
  "host",
  "relay",
  "pluginInventory",
];
export const apply: PluginModule["apply"] = (ctx) => {
  const origin = communityIndexOrigin();
  const host = ctx.host;
  const installer = ctx.reflect.get("pluginInstaller") as
    | PluginInstaller
    | undefined;
  const inventory = ctx.pluginInventory;
  const recorder = createRecorder({
    relay: ctx.relay,
    inventory: {
      installed: () => inventory.installed(),
      subscribe: (listener) => inventory.subscribe(listener),
    },
  });
  ctx.effect(() => () => recorder.stop());
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
        recorder={recorder}
        openPluginSettings={openPluginSettings}
      />
    ),
  });
};
