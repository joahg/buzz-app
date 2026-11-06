import { expect, it, vi } from "vitest";
import {
  accessSummary,
  installLabel,
  loadIndex,
  parseIndex,
  ranked,
  search,
} from "./catalog";
import { listing, rawIndex } from "./testing";

it("keeps only valid listings, once each", () => {
  const good = listing();
  const other = listing({
    key: "github.com/octo/other",
    slug: "github-com--octo--other",
    id: "octo.other",
    source: { ...good.source, repository: "https://github.com/octo/other" },
  });
  const index = parseIndex(
    rawIndex([
      good,
      other,
      { ...good, slug: "duplicate" },
      { ...good, key: "gitlab.com/x/y", slug: "elsewhere" },
      { ...good, key: "github.com/block/x", slug: "fake-official" },
    ]),
  );
  expect(index?.plugins.map((plugin) => plugin.slug)).toEqual([
    good.slug,
    other.slug,
  ]);
});

it("orders by community counts, then by the index's own order", () => {
  const a = listing({
    key: "github.com/octo/a",
    slug: "a",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  const b = listing({
    key: "github.com/octo/b",
    slug: "b",
    updatedAt: "2026-03-01T00:00:00Z",
  });
  const c = listing({ key: "github.com/octo/c", slug: "c" });
  const index = {
    schemaVersion: 1 as const,
    generatedAt: "",
    plugins: [a, b, c],
  };
  const counts = {
    installs: (key: string) => (key === c.key ? 3 : key === b.key ? 1 : 0),
    upvotes: (key: string) => (key === a.key ? 2 : 0),
  };
  const slugs = (sort: "installs" | "upvotes" | "updated", withCounts = true) =>
    ranked(index, sort, withCounts ? counts : undefined).map((p) => p.slug);
  expect(slugs("installs")).toEqual(["c", "b", "a"]);
  expect(slugs("upvotes")).toEqual(["a", "b", "c"]);
  expect(slugs("updated")).toEqual(["b", "a", "c"]);
  expect(slugs("installs", false)).toEqual(["a", "b", "c"]);
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
  expect(installLabel(12)).toBe("Installed by 12 people here");
  expect(installLabel(1)).toBe("Installed by 1 person here");
  expect(installLabel(0)).toBe("Not installed here yet");
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
