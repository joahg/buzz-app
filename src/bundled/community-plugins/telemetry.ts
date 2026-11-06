import type { Host } from "../../features/host/service";
import { type Listing, parseKey } from "./catalog";

type Requester = Pick<Host, "request">;

export const CLIENT = "buzz-community-plugins/1";
export const SALT_KEY = "buzz.community-plugins.salt.v1";
export const SHARE_KEY = "buzz.community-plugins.share.v1";
export const REPORTED_KEY = "buzz.community-plugins.reported.v1";
export const VOTES_KEY = "buzz.community-plugins.votes.v1";

export function shareEnabled(): boolean {
  try {
    return window.localStorage.getItem(SHARE_KEY) !== "off";
  } catch {
    return false;
  }
}

export function setShareEnabled(on: boolean) {
  try {
    window.localStorage.setItem(SHARE_KEY, on ? "on" : "off");
  } catch {}
}

function readKeys(storageKey: string): Set<string> {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(storageKey) ?? "[]",
    ) as unknown;
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((key): key is string => typeof key === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function writeKeys(storageKey: string, keys: Set<string>) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify([...keys]));
  } catch {}
}

export const hasReported = (key: string) => readKeys(REPORTED_KEY).has(key);
export const hasUpvoted = (key: string) => readKeys(VOTES_KEY).has(key);

const hex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

function localSalt(): string | null {
  try {
    const stored = window.localStorage.getItem(SALT_KEY);
    if (stored && /^[0-9a-f]{64}$/.test(stored)) return stored;
    const salt = hex(crypto.getRandomValues(new Uint8Array(32)));
    window.localStorage.setItem(SALT_KEY, salt);
    return window.localStorage.getItem(SALT_KEY) === salt ? salt : null;
  } catch {
    return null;
  }
}

/** A per-device, per-plugin identifier the index can count but not trace back. */
export async function installerHash(id: string): Promise<string | null> {
  const salt = localSalt();
  if (!salt) return null;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${salt}:${id}`),
  );
  return hex(new Uint8Array(digest));
}

async function isPublicRepository(
  host: Requester,
  owner: string,
  repo: string,
) {
  const response = await host.request({
    url: `https://api.github.com/repos/${owner}/${repo}`,
    headers: { accept: "application/vnd.github+json" },
    timeoutMs: 8000,
  });
  if (response.status !== 200) return false;
  return (JSON.parse(response.body) as { private?: unknown }).private === false;
}

/** Counts a confirmed install once, only for a public repository and while sharing is on. */
export async function reportInstall(
  host: Requester,
  origin: string,
  listing: Listing,
): Promise<boolean> {
  const parts = parseKey(listing.key);
  if (!origin || !parts || !shareEnabled()) return false;
  try {
    if (!(await isPublicRepository(host, parts.owner, parts.repo)))
      return false;
    if (!shareEnabled()) return false;
    const installer = await installerHash(listing.id);
    if (!installer) return false;
    const response = await host.request({
      url: `${origin}/v1/installs`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key: listing.key,
        id: listing.id,
        commit: listing.source.commit,
        installer,
        client: CLIENT,
      }),
      timeoutMs: 8000,
    });
    if (response.status !== 202) return false;
    writeKeys(REPORTED_KEY, readKeys(REPORTED_KEY).add(listing.key));
    return true;
  } catch {
    return false;
  }
}

export const canVote = (listing: Listing) =>
  shareEnabled() && hasReported(listing.key);

export async function sendVote(
  host: Requester,
  origin: string,
  listing: Listing,
  vote: boolean,
): Promise<boolean> {
  if (!origin || !canVote(listing)) return false;
  try {
    const voter = await installerHash(listing.id);
    if (!voter) return false;
    const response = await host.request({
      url: `${origin}/v1/votes`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key: listing.key,
        id: listing.id,
        voter,
        vote: vote ? 1 : 0,
        client: CLIENT,
      }),
      timeoutMs: 8000,
    });
    if (response.status !== 202) return false;
    const keys = readKeys(VOTES_KEY);
    if (vote) keys.add(listing.key);
    else keys.delete(listing.key);
    writeKeys(VOTES_KEY, keys);
    return true;
  } catch {
    return false;
  }
}
