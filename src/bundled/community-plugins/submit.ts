import type { Host } from "../../features/host/service";

type Requester = Pick<Host, "request">;

export type SourceInput = Readonly<{
  owner: string;
  repo: string;
  ref?: string;
  path: string;
}>;
export type CheckedSource = Readonly<{
  owner: string;
  repo: string;
  ref: string;
  path: string;
  id: string;
  name: string;
  description: string;
}>;
export type CheckResult =
  | { ok: true; source: CheckedSource }
  | { ok: false; message: string };
export type SubmitResult =
  | { ok: true; status: "queued" | "listed"; slug?: string; name: string }
  | { ok: false; message: string };

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const SEGMENT = /^[A-Za-z0-9._-]+$/;
const REF = /^[A-Za-z0-9_][A-Za-z0-9_./+-]{0,199}$/;
const PLUGIN_ID = /^[a-z][a-z0-9.-]{0,79}$/;

const validName = (value: string) =>
  NAME.test(value) && value !== "." && value !== "..";
const validPath = (segments: string[]) =>
  segments.every(
    (segment) => SEGMENT.test(segment) && segment !== "." && segment !== "..",
  );
export const validRef = (ref: string) =>
  REF.test(ref) &&
  !ref.includes("..") &&
  !ref.endsWith("/") &&
  !ref.endsWith(".lock");

/** Accepts owner/repo, owner/repo/folder or a github.com link, with an optional branch or tag. */
export function parseSourceInput(
  text: string,
  refText = "",
): SourceInput | null {
  const segments = text
    .trim()
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/^github\.com\//, "")
    .replace(/\/+$/, "")
    .split("/")
    .filter((segment) => segment !== "");
  const [owner, rawRepo, ...tail] = segments;
  if (!owner || !rawRepo) return null;
  const repo = rawRepo.replace(/\.git$/, "");
  if (!validName(owner) || !validName(repo)) return null;
  let ref = refText.trim() || undefined;
  let path = tail;
  if (tail[0] === "tree" && tail[1]) {
    ref ??= tail[1];
    path = tail.slice(2);
  }
  if (!validPath(path)) return null;
  if (ref !== undefined && !validRef(ref)) return null;
  return ref === undefined
    ? { owner, repo, path: path.join("/") }
    : { owner, repo, ref, path: path.join("/") };
}

export const describeSource = (
  source: Pick<SourceInput, "owner" | "repo" | "path">,
) =>
  source.path
    ? `${source.owner}/${source.repo}/${source.path}`
    : `${source.owner}/${source.repo}`;

const where = (path: string) =>
  path ? `the ${path} folder` : "the repository root";

const github = (host: Requester, url: string, method: "GET" | "HEAD") =>
  host.request({
    url,
    method,
    headers: { accept: "application/vnd.github+json" },
    timeoutMs: 10000,
  });

function decodeBase64(text: string) {
  const binary = atob(text.replace(/\s/g, ""));
  return new TextDecoder().decode(
    Uint8Array.from(binary, (char) => char.charCodeAt(0)),
  );
}

/** Checks anonymously, through GitHub's API only, that a source is public and has a built plugin. */
export async function checkSource(
  host: Requester,
  input: SourceInput,
): Promise<CheckResult> {
  const label = `${input.owner}/${input.repo}`;
  const api = `https://api.github.com/repos/${input.owner}/${input.repo}`;
  const retry = (what: string, status: number) => ({
    ok: false as const,
    message: `GitHub didn't return ${what} (HTTP ${status}). Try again in a few minutes.`,
  });
  try {
    const repo = await github(host, api, "GET");
    if (repo.status === 404)
      return {
        ok: false,
        message: `GitHub can't find ${label}. Check the name, and that the repository is public.`,
      };
    if (repo.status !== 200) return retry(label, repo.status);
    const info = JSON.parse(repo.body) as {
      private?: unknown;
      default_branch?: unknown;
    };
    if (info.private !== false)
      return {
        ok: false,
        message: `${label} is private. Only public repositories can be listed.`,
      };
    const ref =
      input.ref ??
      (typeof info.default_branch === "string" ? info.default_branch : "main");
    const file = (name: string) =>
      `${api}/contents/${[...(input.path ? input.path.split("/") : []), name]
        .map(encodeURIComponent)
        .join("/")}?ref=${encodeURIComponent(ref)}`;

    const manifestRes = await github(host, file("manifest.json"), "GET");
    if (manifestRes.status === 404)
      return {
        ok: false,
        message: `There's no manifest.json in ${where(input.path)} on ${ref}. Commit the built manifest.json and plugin.js there.`,
      };
    if (manifestRes.status !== 200)
      return retry("manifest.json", manifestRes.status);
    let manifest: { id?: unknown; name?: unknown; description?: unknown };
    try {
      const entry = JSON.parse(manifestRes.body) as {
        content?: unknown;
        encoding?: unknown;
      };
      if (entry.encoding !== "base64" || typeof entry.content !== "string")
        return { ok: false, message: "manifest.json is too large to read." };
      manifest = JSON.parse(decodeBase64(entry.content)) as typeof manifest;
    } catch {
      return { ok: false, message: "manifest.json isn't valid JSON." };
    }
    if (typeof manifest !== "object" || manifest === null)
      return { ok: false, message: "manifest.json isn't a JSON object." };
    if (typeof manifest.id !== "string" || !PLUGIN_ID.test(manifest.id))
      return {
        ok: false,
        message:
          "manifest.json needs an id made of lowercase letters, digits, dots and dashes, such as com.example.notes.",
      };
    if (typeof manifest.name !== "string" || !manifest.name.trim())
      return { ok: false, message: "manifest.json needs a name." };

    const plugin = await github(host, file("plugin.js"), "HEAD");
    if (plugin.status === 404)
      return {
        ok: false,
        message: `There's no plugin.js next to manifest.json on ${ref}. Commit the built plugin, not only its source.`,
      };
    if (plugin.status !== 200) return retry("plugin.js", plugin.status);

    return {
      ok: true,
      source: {
        owner: input.owner,
        repo: input.repo,
        ref,
        path: input.path,
        id: manifest.id,
        name: manifest.name.trim(),
        description:
          typeof manifest.description === "string" ? manifest.description : "",
      },
    };
  } catch {
    return {
      ok: false,
      message: "Couldn't reach GitHub. Check your connection and try again.",
    };
  }
}

export async function submitSource(
  host: Requester,
  origin: string,
  source: CheckedSource,
): Promise<SubmitResult> {
  if (!origin)
    return {
      ok: false,
      message: "This build of Buzz has no community index.",
    };
  try {
    const response = await host.request({
      url: `${origin}/v1/sources`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repository: `${source.owner}/${source.repo}`,
        ref: source.ref,
        ...(source.path ? { path: source.path } : {}),
      }),
      timeoutMs: 60000,
    });
    if (response.status === 429)
      return {
        ok: false,
        message: "You've submitted a lot today. Try again tomorrow.",
      };
    if (response.status === 503)
      return {
        ok: false,
        message:
          "The index couldn't check GitHub just now. Try again in a few minutes.",
      };
    let body: {
      status?: unknown;
      listing?: { slug?: unknown; name?: unknown };
      detail?: unknown;
    } = {};
    try {
      body = JSON.parse(response.body) as typeof body;
    } catch {}
    if (
      response.status === 200 &&
      (body.status === "queued" || body.status === "listed")
    )
      return {
        ok: true,
        status: body.status,
        ...(typeof body.listing?.slug === "string"
          ? { slug: body.listing.slug }
          : {}),
        name:
          typeof body.listing?.name === "string"
            ? body.listing.name
            : source.name,
      };
    if (response.status === 422 && typeof body.detail === "string")
      return {
        ok: false,
        message: `The index couldn't list it: ${body.detail}`,
      };
    return {
      ok: false,
      message: `The index didn't accept it (HTTP ${response.status}). Try again later.`,
    };
  } catch {
    return {
      ok: false,
      message: "Couldn't reach the index. Check your connection and try again.",
    };
  }
}
