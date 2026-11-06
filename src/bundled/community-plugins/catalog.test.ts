import { expect, it, vi } from "vitest";
import {
  accessSummary,
  installLine,
  loadIndex,
  parseIndex,
  ranked,
  search,
} from "./catalog";
import { listing, rawIndex } from "./testing";

it("keeps only valid listings and drops rankings for ineligible ones", () => {
  const good = listing();
  const uncleared = listing({
    key: "github.com/octo/other",
    slug: "github-com--octo--other",
    id: "octo.other",
    source: { ...good.source, repository: "https://github.com/octo/other" },
    audit: { tier: "high", flags: [], cleared: false },
  });
  const index = parseIndex(
    rawIndex(
      [
        good,
        uncleared,
        { ...good, slug: "duplicate" },
        { ...good, key: "gitlab.com/x/y", slug: "elsewhere" },
        { ...good, key: "github.com/block/x", slug: "fake-official" },
      ],
      {
        allTime: [uncleared.key],
        trending: [uncleared.key, good.key, "github.com/missing/plugin"],
        hot: [good.key],
        mostUpvoted: [uncleared.key, good.key],
      },
    ),
  );
  expect(index?.plugins.map((plugin) => plugin.slug)).toEqual([
    good.slug,
    uncleared.slug,
  ]);
  expect(index?.rankings).toEqual({
    allTime: [uncleared.key, good.key],
    trending: [good.key],
    hot: [good.key],
    mostUpvoted: [good.key],
  });
  if (!index) throw new Error("expected an index");
  expect(ranked(index, "trending").map((plugin) => plugin.id)).toEqual([
    "octo.notes",
  ]);
});

it("rejects an index whose listings are all invalid or whose schema is unknown", () => {
  expect(parseIndex(rawIndex([{ key: "nope" }]))).toBeNull();
  expect(parseIndex({ ...rawIndex([]), schemaVersion: 2 })).toBeNull();
  expect(parseIndex(rawIndex([]))?.plugins).toEqual([]);
});

it("searches names, taglines, authors and tags within a category", () => {
  const plugins = [listing(), listing({ slug: "b", tags: ["kanban"] })];
  expect(search(plugins, "OCTO notes", "")).toHaveLength(2);
  expect(search(plugins, "kanban", "")).toEqual([plugins[1]]);
  expect(search(plugins, "", "communication")).toEqual([]);
});

it("summarizes counts and access in plain language", () => {
  expect(installLine(listing(), "allTime")).toBe("Added by 12 people");
  expect(installLine(listing(), "trending")).toBe(
    "Added by 12 people · +2 today",
  );
  expect(
    installLine(
      listing({ installs: { allTime: 0, last24h: 0, last7d: 0 } }),
      "hot",
    ),
  ).toBe("New");
  expect(
    accessSummary({ networkOrigins: ["https://api.example"], files: true }),
  ).toEqual(["Connect to api.example", "Read files with your access"]);
});

it("reads the index from the configured origin and reports bad answers", async () => {
  const request = vi.fn(async () => ({
    status: 200,
    headers: {},
    body: JSON.stringify(rawIndex([listing()])),
  }));
  await expect(
    loadIndex({ request }, "https://plugins.example"),
  ).resolves.toMatchObject({ plugins: [{ id: "octo.notes" }] });
  expect(request).toHaveBeenCalledWith({
    url: "https://plugins.example/v1/index.json",
    timeoutMs: 8000,
  });
  request.mockResolvedValueOnce({ status: 503, headers: {}, body: "" });
  await expect(
    loadIndex({ request }, "https://plugins.example"),
  ).rejects.toThrow("The community index answered 503.");
});
