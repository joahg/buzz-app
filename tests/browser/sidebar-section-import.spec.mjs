import { test, expect } from "./fixture.mjs";
import { openPage } from "./navigation.mjs";

// Browser ownership: menu-to-modal focus, outline preview against the real
// roster, and persisted sections through the production preference broker.
// Parsing and matching permutations stay in section-import.test.ts.
test.use({ productionBroker: true, savedSidebar: true, largeSidebar: false });

test("Channels imports a pasted outline into persisted sections", async ({
  page,
  app,
}) => {
  await page.goto(app.origin);
  await openPage(page, "Messages");
  const trigger = page.getByRole("button", {
    name: "More actions for Channels",
    exact: true,
  });
  await trigger.click();
  await page
    .getByRole("menuitem", { name: "Import sections", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Import sections" });
  const field = dialog.getByRole("textbox", { name: "Sections" });
  await expect(field).toBeFocused();
  await expect(page.getByRole("menu")).toHaveCount(0);

  await field.fill(
    ["Work", "#alpha", "", "Launch", "- beta", "#nope"].join("\n"),
  );
  const preview = dialog.getByRole("list", { name: "Import preview" });
  await expect(preview.getByRole("listitem")).toHaveText([
    "Work · existing · 0 channelsStaying in Starred: alpha",
    "Launch · new · 1 channelNot in your channels: nope",
  ]);
  await dialog
    .getByRole("button", { name: "Import 1 channel", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  const launch = page
    .locator('[data-sidebar-section^="group:"]')
    .filter({ has: page.locator("summary").filter({ hasText: /^Launch$/ }) });
  await expect(launch.locator('[data-channel-id="beta"]')).toBeVisible();
  await expect
    .poll(() => {
      const publications = app.report.sidebarPublications ?? [];
      return publications.at(-1)?.blob.assignments.beta;
    })
    .not.toBe("work");
  await page.reload();
  await openPage(page, "Messages");
  await expect(launch.locator('[data-channel-id="beta"]')).toBeVisible();
  await expect(
    page.locator(
      '[data-sidebar-section="group:work"] [data-channel-id="beta"]',
    ),
  ).toHaveCount(0);
});
