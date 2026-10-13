import { openChannelDetails } from "./channel-details.mjs";
import { openPage } from "./navigation.mjs";
import { test, expect } from "./fixture.mjs";
test.use({
  productionBroker: true,
  historyCounts: { alpha: 1, beta: 1 },
});
test("clean pending setup stays in diagnostics and never flashes a warning during channel switches", async ({
  page,
  app,
}) => {
  app.relay.holdEose("beta");
  await page.goto(app.origin);
  await page.evaluate(() => {
    window.__bannerSeen = [];
    window.__bannerObserver = new MutationObserver(() => {
      for (const status of document.querySelectorAll(
        '[role="status"][aria-label="Reconnecting to relay…"], [role="status"][aria-label="Live updates limited"]',
      )) {
        window.__bannerSeen.push(status.textContent);
      }
    });
    window.__bannerObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });

  await openPage(page, "Messages");
  await expect(
    page.getByRole("textbox", { name: "Message #Alpha", exact: true }),
  ).toBeVisible();
  const warning = page.getByRole("status", {
    name: /^(Reconnecting to relay…|Live updates limited)$/,
  });
  await expect.poll(() => app.relay.hasRoute("primary", "beta")).toBe(true);
  await expect(warning).toHaveCount(0);
  const streams = () =>
    app.report.brokerRequests.filter((r) => r.url.endsWith("/stream")).length;
  const before = streams();
  await page.getByRole("button", { name: "Beta", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Message #Beta", exact: true }),
  ).toBeVisible();
  await expect(warning).toHaveCount(0);
  await openChannelDetails(page);
  await openDiagnostics(page);
  await expect(
    page.getByText("Live updates: connecting", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close Channel settings tab", exact: true })
    .click();
  expect(app.relay.rejected).toHaveLength(0);
  expect(app.report.wireFrames.filter((f) => f[0] === "CLOSED")).toHaveLength(
    0,
  );
  expect(streams()).toBe(before);
  app.relay.releaseEose("beta");
  await expect(warning).toHaveCount(0);
  for (const channel of ["Alpha", "Beta", "Alpha", "Beta"]) {
    await page.getByRole("button", { name: channel, exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: `Message #${channel}`, exact: true }),
    ).toBeVisible();
  }
  const warm = await page.evaluate(() => {
    window.__bannerObserver.disconnect();
    return window.__bannerSeen;
  });
  expect(warm).toEqual([]);
  expect(streams()).toBe(before);
  app.report.measurements.push({
    rejected: app.relay.rejected,
    warmSwitchWarnings: warm,
    streamsBefore: before,
    streamsAfter: streams(),
  });
});

const notice = (page) =>
  page.getByRole("status", { name: "Reconnecting to relay…", exact: true });
const retryNow = (page) =>
  notice(page).getByRole("button", { name: "Retry now", exact: true });

for (const target of ["alpha", "profiles"]) {
  test(`quota recovery for ${target} stays quiet until attempts exhaust, then keeps retrying automatically until EOSE`, async ({
    page,
    app,
  }, testInfo) => {
    if (target === "profiles")
      await page.addInitScript(() =>
        localStorage.setItem("buzz-appearance.v1", "dark"),
      );
    await page.goto(app.origin);
    await openPage(page, "Messages");
    await expect(
      page.getByRole("textbox", { name: "Message #Alpha", exact: true }),
    ).toBeVisible();
    await expect.poll(() => app.relay.hasRoute("primary", target)).toBe(true);
    // Recovery never falls back to the unrecoverable "limited" status.
    const warning = page.getByRole("status", {
      name: "Live updates limited",
      exact: true,
    });
    await expect(warning).toHaveCount(0);
    await openChannelDetails(page);
    await openDiagnostics(page);
    const recovery = page.getByText(
      "Live updates: recovering automatically after rate limiting; awaiting confirmation",
      { exact: true },
    );
    const rejected = "rate-limited: quota exceeded; retry in 0s";
    app.relay.holdEose(target);
    const requests = () =>
      app.relay.requests.filter(
        (r) => r.community === "primary" && r.routes.includes(target),
      );
    const streams = () =>
      app.report.brokerRequests.filter((r) => r.url.endsWith("/stream")).length;
    const streamCount = streams();
    const sockets = app.relay.sockets.length;
    for (let attempt = 0; attempt < 4; attempt++) {
      const before = requests().length;
      app.relay.failRoute("primary", target, rejected);
      if (attempt < 3) {
        await expect(recovery).toBeVisible();
        await expect(warning).toHaveCount(0);
        await expect(notice(page)).toHaveCount(0);
        await expect.poll(() => requests().length).toBeGreaterThan(before);
        // The new REQ exists, but fixture holds EOSE: no false healthy status.
        await expect(recovery).toBeVisible();
        await expect(warning).toHaveCount(0);
      } else {
        // Exhausted stream recovery hands over to session recovery: one
        // notice, and a new REQ with no click.
        await expect(notice(page)).toBeVisible();
        await expect(warning).toHaveCount(0);
        await expect.poll(() => requests().length).toBeGreaterThan(before);
      }
    }
    // The notice keeps showing while the retried REQ waits for EOSE, and it
    // must not block the header, composer, or narrow navigation.
    for (const width of [390, 800, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      await page
        .getByRole("button", {
          name: "Close Channel settings tab",
          exact: true,
        })
        .click();
      await page
        .getByRole("textbox", { name: "Message #Alpha", exact: true })
        .fill("Unsent recovery draft");
      await expect(notice(page)).toHaveCount(1); // Diagnostics must not duplicate it.
      await expect(warning).toHaveCount(0);
      await expect(
        page.getByRole("dialog", { name: "Reconnecting to relay…" }),
      ).toHaveCount(0); // Nor a floating copy.
      await expect(notice(page)).toHaveCSS("opacity", "1");
      const composer = page
        .getByRole("textbox", {
          name: "Message #Alpha",
          exact: true,
        })
        .locator("xpath=ancestor::form");
      await expect
        .poll(async () => {
          const box = await notice(page).boundingBox();
          const form = await composer.boundingBox();
          return box && form ? box.y + box.height <= form.y : false;
        })
        .toBe(true);
      await composer
        .getByRole("button", {
          name: "Send message",
          exact: true,
        })
        .click({ trial: true });
      await page.screenshot({
        path: testInfo.outputPath(`recovery-app-${target}-${width}.png`),
      });
      await openChannelDetails(page);
      await openDiagnostics(page);
      await expect(notice(page)).toHaveCount(1);
    }
    const beforeManual = requests().length;
    await page
      .getByRole("button", { name: "Close Channel settings tab", exact: true })
      .click();
    // Retry now stays available to skip the wait.
    await retryNow(page).focus();
    await retryNow(page).press("Enter");
    await expect.poll(() => requests().length).toBeGreaterThan(beforeManual);
    await expect(notice(page)).toBeVisible();
    app.relay.releaseEose(target);
    await expect(notice(page)).toHaveCount(0);
    await openChannelDetails(page);
    await openDiagnostics(page);
    await expect(
      page.getByText("Live updates: stream established", { exact: true }),
    ).toBeVisible();
    await expect(warning).toHaveCount(0);
    expect(streams()).toBe(streamCount);
    expect(app.relay.sockets).toHaveLength(sockets);
  });
}

// Browser layout: a long, unbroken relay reason stays out of the inline
// recovery notice, which sits above the composer with keyboard Retry now
// reachable at enlarged text size.
test("long recovery stays bounded above the composer at enlarged text size", async ({
  page,
  app,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto(app.origin);
  await openPage(page, "Messages");
  const input = page.getByRole("textbox", {
    name: "Message #Alpha",
    exact: true,
  });
  await expect(input).toBeVisible();
  await expect.poll(() => app.relay.hasRoute("primary", "alpha")).toBe(true);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "20px";
  });
  app.relay.holdEose("alpha");
  app.relay.failRoute(
    "primary",
    "alpha",
    `error: ${"Unavailable".repeat(160)}`,
  );
  const warning = notice(page);
  await expect(warning).toBeVisible();
  await input.fill("Unsent recovery draft");
  const form = input.locator("xpath=ancestor::form");
  await expect
    .poll(async () => {
      const box = await warning.boundingBox();
      const composer = await form.boundingBox();
      return (
        !!box &&
        !!composer &&
        box.y + box.height <= composer.y &&
        composer.y + composer.height <= 600
      );
    })
    .toBe(true);
  await expect(warning).toHaveText(/^Reconnecting to relay…Retry now$/);
  await form
    .getByRole("button", { name: "Send message", exact: true })
    .click({ trial: true });
  await input.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(retryNow(page)).toBeFocused();
  await expect(retryNow(page)).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("recovery-long-enlarged.png"),
  });
  await retryNow(page).press("Enter");
  app.relay.releaseEose("alpha");
  await expect(notice(page)).toHaveCount(0);
  await expect(input).toHaveText("Unsent recovery draft");
});

async function openDiagnostics(page) {
  // A quick reopen can retain the outgoing settings DOM during its exit.
  const summary = page.getByText("Diagnostics", { exact: true });
  if ((await summary.locator("..").getAttribute("open")) === null)
    await summary.click();
  await expect(summary.locator("..")).toHaveAttribute("open", "");
}
