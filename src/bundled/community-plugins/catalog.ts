import type { Host } from "../../features/host/service";
import { pluginCategoryDefinitions } from "../../app/plugin-categories";

export type Media = Readonly<{ url: string; type?: string; caption?: string }>;
export type SetupStep = Readonly<{
  title: string;
  detail?: string;
  command?: string;
}>;
export type AuditTier = "low" | "medium" | "high";
export type AuditFlag = Readonly<{ code: string; detail: string }>;
export type Listing = Readonly<{
  key: string;
  slug: string;
  id: string;
  name: string;
  tagline: string;
  description?: string;
  category: string;
  tags?: readonly string[];
  author: Readonly<{ github: string }>;
  official: boolean;
  source: Readonly<{
    repository: string;
    ref: string;
    commit: string;
    path?: string;
  }>;
  host: Readonly<{
    networkOrigins?: readonly string[];
    processes?: readonly string[];
    commands?: readonly string[];
    files?: boolean;
    mcp?: boolean;
    agentHooks?: boolean;
  }>;
  audit: Readonly<{
    tier: AuditTier;
    flags: readonly AuditFlag[];
    accessChanged?: boolean;
    cleared: boolean;
    checkedAt?: string;
  }>;
  demo?: Readonly<{
    video?: Media | null;
    poster?: Media | null;
    screenshots?: readonly Media[];
  }>;
  setup?: readonly SetupStep[];
  links?: Readonly<Record<string, string>>;
  updatedAt?: string;
  installs: Readonly<{ allTime: number; last24h: number; last7d: number }>;
  upvotes?: number;
}>;
export type Rankings = Readonly<{
  allTime: readonly string[];
  trending: readonly string[];
  hot: readonly string[];
  mostUpvoted: readonly string[];
}>;
export type Index = Readonly<{
  schemaVersion: 1;
  generatedAt: string;
  collectionStartedAt: string;
  plugins: readonly Listing[];
  rankings: Rankings;
}>;
export type Sort = keyof Rankings;

export const categories: ReadonlyMap<string, string> = new Map(
  pluginCategoryDefinitions.map(({ id, label }) => [id, label]),
);

export const sorts: readonly Readonly<{ id: Sort; label: string }>[] = [
  { id: "allTime", label: "All time" },
  { id: "trending", label: "Trending" },
  { id: "hot", label: "Hot" },
  { id: "mostUpvoted", label: "Most upvoted" },
];

const KEY =
  /^github\.com\/([A-Za-z0-9._-]{1,100})\/([A-Za-z0-9._-]{1,100})((?:\/[A-Za-z0-9._@+-]{1,100}){0,8})$/;

export function parseKey(
  key: string,
): { owner: string; repo: string; path: string } | null {
  const [, owner = "", repo = "", rest = ""] = KEY.exec(key) ?? [];
  if (
    !owner ||
    rest.split("/").some((segment) => segment === "." || segment === "..")
  )
    return null;
  return { owner, repo, path: rest.slice(1) };
}

const text = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
const count = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const strings = (value: unknown) =>
  value === undefined || (Array.isArray(value) && value.every(text));
const flag = (value: unknown) =>
  value === undefined || typeof value === "boolean";
export const httpsUrl = (url: unknown): url is string =>
  typeof url === "string" && /^https:\/\/[^\s/]+\/\S*$/.test(url);
const media = (value: unknown) =>
  value == null ||
  (!!value && typeof value === "object" && httpsUrl((value as Media).url));

function validListing(value: unknown): value is Listing {
  const listing = value as Listing;
  if (!listing || typeof listing !== "object") return false;
  const parts = typeof listing.key === "string" ? parseKey(listing.key) : null;
  if (!parts) return false;
  const { host, audit, source, installs, demo } = listing;
  return (
    /^[a-z0-9-]{1,120}$/.test(String(listing.slug)) &&
    /^[a-z][a-z0-9.-]{0,79}$/.test(String(listing.id)) &&
    text(listing.name) &&
    typeof listing.tagline === "string" &&
    (listing.description === undefined ||
      typeof listing.description === "string") &&
    categories.has(listing.category) &&
    strings(listing.tags) &&
    text(listing.author?.github) &&
    listing.official === (parts.owner === "block") &&
    source?.repository === `https://github.com/${parts.owner}/${parts.repo}` &&
    text(source.ref) &&
    /^[0-9a-f]{40}$/.test(String(source.commit)) &&
    (source.path === undefined || source.path === parts.path) &&
    !!host &&
    typeof host === "object" &&
    (host.networkOrigins ?? []).every((origin) =>
      /^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(origin),
    ) &&
    strings(host.processes) &&
    strings(host.commands) &&
    [host.files, host.mcp, host.agentHooks].every(flag) &&
    ["low", "medium", "high"].includes(String(audit?.tier)) &&
    Array.isArray(audit.flags) &&
    audit.flags.every((item) => text(item?.code) && text(item?.detail)) &&
    typeof audit.cleared === "boolean" &&
    !!installs &&
    [installs.allTime, installs.last24h, installs.last7d].every(count) &&
    (listing.upvotes === undefined || count(listing.upvotes)) &&
    (demo === undefined ||
      (media(demo.video) &&
        media(demo.poster) &&
        (demo.screenshots ?? []).every((shot) => media(shot)))) &&
    (listing.setup ?? []).every((step) => text(step?.title)) &&
    (listing.links === undefined ||
      (!!listing.links && typeof listing.links === "object"))
  );
}

function sanitizeRankings(
  value: unknown,
  plugins: readonly Listing[],
): Rankings {
  const byKey = new Map(plugins.map((plugin) => [plugin.key, plugin]));
  const listed = (name: Sort, eligible: (plugin: Listing) => boolean) => {
    const raw = (value as Record<string, unknown> | undefined)?.[name];
    const seen = new Set<string>();
    for (const key of Array.isArray(raw) ? raw : []) {
      const plugin = typeof key === "string" ? byKey.get(key) : undefined;
      if (plugin && eligible(plugin)) seen.add(plugin.key);
    }
    return [...seen];
  };
  const allTime = listed("allTime", () => true);
  const rest = plugins
    .filter((plugin) => !allTime.includes(plugin.key))
    .sort((a, b) => b.installs.allTime - a.installs.allTime)
    .map((plugin) => plugin.key);
  return {
    allTime: [...allTime, ...rest],
    trending: listed("trending", (plugin) => plugin.audit.cleared),
    hot: listed("hot", (plugin) => plugin.audit.cleared),
    mostUpvoted: listed(
      "mostUpvoted",
      (plugin) => plugin.audit.cleared && (plugin.upvotes ?? 0) > 0,
    ),
  };
}

export function parseIndex(value: unknown): Index | null {
  const raw = value as Record<string, unknown> | null;
  if (
    !raw ||
    typeof raw !== "object" ||
    raw.schemaVersion !== 1 ||
    !Array.isArray(raw.plugins)
  )
    return null;
  const slugs = new Set<string>();
  const keys = new Set<string>();
  const plugins = raw.plugins.filter((plugin): plugin is Listing => {
    if (!validListing(plugin) || slugs.has(plugin.slug) || keys.has(plugin.key))
      return false;
    slugs.add(plugin.slug);
    keys.add(plugin.key);
    return true;
  });
  if (raw.plugins.length && !plugins.length) return null;
  const generatedAt = Date.parse(String(raw.generatedAt));
  const collectionStartedAt = Date.parse(String(raw.collectionStartedAt));
  if (!Number.isFinite(generatedAt) || !Number.isFinite(collectionStartedAt))
    return null;
  return {
    schemaVersion: 1,
    generatedAt: new Date(generatedAt).toISOString(),
    collectionStartedAt: new Date(collectionStartedAt).toISOString(),
    plugins,
    rankings: sanitizeRankings(raw.rankings, plugins),
  };
}

export async function loadIndex(
  host: Pick<Host, "request">,
  origin: string,
): Promise<Index> {
  const response = await host.request({
    url: `${origin}/v1/index.json`,
    timeoutMs: 8000,
  });
  if (response.status !== 200)
    throw new Error(`The community index answered ${response.status}.`);
  const index = parseIndex(JSON.parse(response.body));
  if (!index)
    throw new Error("The community index isn't in a format Buzz reads.");
  return index;
}

export function ranked(index: Index, sort: Sort): Listing[] {
  const byKey = new Map(index.plugins.map((plugin) => [plugin.key, plugin]));
  return index.rankings[sort].flatMap((key) => byKey.get(key) ?? []);
}

export function search(
  plugins: readonly Listing[],
  query: string,
  category: string,
) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return plugins.filter((plugin) => {
    if (category && plugin.category !== category) return false;
    if (!words.length) return true;
    const haystack = [
      plugin.name,
      plugin.tagline,
      plugin.description,
      plugin.author.github,
      ...(plugin.tags ?? []),
    ]
      .join(" ")
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export function accessSummary(host: Listing["host"]): string[] {
  return [
    ...(host.networkOrigins ?? []).map(
      (origin) => `Connect to ${origin.replace(/^https:\/\//, "")}`,
    ),
    ...(host.processes ?? []).map((process) => `Run ${process}`),
    ...(host.commands ?? []).map((command) => `Run ${command}`),
    ...(host.files ? ["Read files with your access"] : []),
    ...(host.mcp ? ["Serve tools to your agents"] : []),
    ...(host.agentHooks ? ["Observe and steer agent turns"] : []),
  ];
}

export const tierLabels: Readonly<Record<AuditTier, string>> = {
  low: "Low access",
  medium: "Network access",
  high: "High access",
};

export function installLine(listing: Listing, sort: Sort): string {
  const { allTime, last24h, last7d } = listing.installs;
  if (!allTime) return "New";
  const added = `Added by ${allTime.toLocaleString("en-US")} ${allTime === 1 ? "person" : "people"}`;
  if (sort === "trending" && last24h)
    return `${added} · +${last24h.toLocaleString("en-US")} today`;
  if (sort === "hot" && last7d)
    return `${added} · +${last7d.toLocaleString("en-US")} this week`;
  return added;
}

export const upvoteLabel = (count: number) =>
  `${count.toLocaleString("en-US")} ${count === 1 ? "upvote" : "upvotes"}`;
