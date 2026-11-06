// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  REPORTED_KEY,
  SALT_KEY,
  SHARE_KEY,
  VOTES_KEY,
  canVote,
  hasUpvoted,
  installerHash,
  reportInstall,
  sendVote,
  setShareEnabled,
} from "./telemetry";
import { listing } from "./testing";

const origin = "https://plugins.example";
afterEach(() => window.localStorage.clear());

function fakeHost(
  repository: { private?: boolean } | number = { private: false },
) {
  const request = vi.fn(async ({ url }: { url: string }) =>
    url.startsWith("https://api.github.com/")
      ? typeof repository === "number"
        ? { status: repository, headers: {}, body: "" }
        : { status: 200, headers: {}, body: JSON.stringify(repository) }
      : { status: 202, headers: {}, body: "{}" },
  );
  return { request };
}

it("derives a stable per-plugin identifier from a device-local salt", async () => {
  const first = await installerHash("octo.notes");
  expect(first).toMatch(/^[0-9a-f]{64}$/);
  expect(await installerHash("octo.notes")).toBe(first);
  expect(await installerHash("octo.other")).not.toBe(first);
  expect(window.localStorage.getItem(SALT_KEY)).toMatch(/^[0-9a-f]{64}$/);
});

it("reports a confirmed install of a public repository once sharing allows it", async () => {
  const host = fakeHost();
  expect(await reportInstall(host, origin, listing())).toBe(true);
  const ping = host.request.mock.lastCall?.[0] as {
    url: string;
    body: string;
  };
  expect(ping.url).toBe(`${origin}/v1/installs`);
  expect(JSON.parse(ping.body)).toEqual({
    key: "github.com/octo/notes-plugin",
    id: "octo.notes",
    commit: "a".repeat(40),
    installer: await installerHash("octo.notes"),
    client: "buzz-community-plugins/1",
  });
  expect(window.localStorage.getItem(REPORTED_KEY)).toContain(
    "github.com/octo/notes-plugin",
  );
  expect(canVote(listing())).toBe(true);
});

it("never names a private or unreadable repository to the index", async () => {
  for (const repository of [{ private: true }, 404]) {
    const host = fakeHost(repository);
    expect(await reportInstall(host, origin, listing())).toBe(false);
    expect(host.request).toHaveBeenCalledTimes(1);
  }
});

it("sends nothing while sharing is off or no index is configured", async () => {
  const host = fakeHost();
  setShareEnabled(false);
  expect(window.localStorage.getItem(SHARE_KEY)).toBe("off");
  expect(await reportInstall(host, origin, listing())).toBe(false);
  setShareEnabled(true);
  expect(await reportInstall(host, "", listing())).toBe(false);
  expect(host.request).not.toHaveBeenCalled();
});

it("upvotes only reported installs and remembers taking a vote back", async () => {
  const host = fakeHost();
  expect(await sendVote(host, origin, listing(), true)).toBe(false);
  expect(host.request).not.toHaveBeenCalled();
  await reportInstall(host, origin, listing());
  expect(await sendVote(host, origin, listing(), true)).toBe(true);
  expect(hasUpvoted(listing().key)).toBe(true);
  const vote = host.request.mock.lastCall?.[0] as {
    url: string;
    body: string;
  };
  expect(vote.url).toBe(`${origin}/v1/votes`);
  expect(JSON.parse(vote.body)).toMatchObject({ vote: 1, id: "octo.notes" });
  expect(await sendVote(host, origin, listing(), false)).toBe(true);
  expect(window.localStorage.getItem(VOTES_KEY)).toBe("[]");
  host.request.mockResolvedValueOnce({ status: 403, headers: {}, body: "" });
  expect(await sendVote(host, origin, listing(), true)).toBe(false);
  expect(hasUpvoted(listing().key)).toBe(false);
});
