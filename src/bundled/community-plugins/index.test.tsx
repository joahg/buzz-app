import { Context } from "@deepseek-ai/cordis";
import { expect, it } from "vitest";
import { provideNavigation } from "../../features/navigation/service";
import { PagesService } from "../../features/pages/service";
import { apply, inject } from ".";

it("registers one primary workspace page and removes it on dispose", async () => {
  const ctx = new Context();
  ctx.provide("pluginStatus", {
    isActive: () => true,
    subscribe: () => () => {},
  });
  const pages = new PagesService(ctx);
  provideNavigation(ctx, undefined);
  ctx.provide("relay", {
    snapshot: () => ({ status: "disconnected" }),
    subscribe: () => () => {},
  });
  ctx.provide("pluginInventory", {
    installed: () => [],
    subscribe: () => () => {},
  });
  ctx.provide("host", {
    request: async () => ({ status: 404, headers: {}, body: "" }),
  });
  const scope = ctx
    .extend({
      pluginOwner: { id: "buzz.community-plugins", revision: "bundled" },
    })
    .plugin({ inject, apply });
  try {
    await scope;
    expect(pages.snapshot()).toMatchObject([
      {
        id: "community-plugins",
        title: "Community plugins",
        layout: "workspace",
        primary: true,
      },
    ]);
    await scope.dispose();
    expect(pages.snapshot()).toEqual([]);
  } finally {
    await scope.dispose();
    await ctx.fiber.dispose();
  }
});
