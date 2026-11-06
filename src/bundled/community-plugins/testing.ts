import type { Listing } from "./catalog";

export const listing = (overrides: Partial<Listing> = {}): Listing => ({
  key: "github.com/octo/notes-plugin",
  slug: "github-com--octo--notes-plugin",
  id: "octo.notes",
  name: "Octo notes",
  tagline: "Keep notes beside conversations.",
  category: "productivity",
  author: { github: "octo" },
  official: false,
  source: {
    repository: "https://github.com/octo/notes-plugin",
    ref: "main",
    commit: "a".repeat(40),
  },
  host: {},
  audit: { tier: "low", flags: [], cleared: true },
  installs: { allTime: 12, last24h: 2, last7d: 5 },
  upvotes: 4,
  ...overrides,
});

export const rawIndex = (plugins: unknown[], rankings: unknown = {}) => ({
  schemaVersion: 1,
  generatedAt: "2026-11-06T00:00:00Z",
  collectionStartedAt: "2026-11-01T00:00:00Z",
  plugins,
  rankings,
});
