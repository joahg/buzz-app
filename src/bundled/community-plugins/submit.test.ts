import { expect, it, vi } from "vitest";
import {
  checkSource,
  describeSource,
  parseSourceInput,
  submitSource,
} from "./submit";

const origin = "https://plugins.example";
const api = "https://api.github.com/repos/octo/notes";
type Answer = { status: number; body?: string };

const encoded = (value: unknown) =>
  JSON.stringify({
    type: "file",
    encoding: "base64",
    content: btoa(JSON.stringify(value)),
  });

function fakeHost(answers: Record<string, Answer>) {
  const request = vi.fn(async ({ url }: { url: string }) => {
    const answer = answers[url] ?? { status: 404 };
    return { status: answer.status, headers: {}, body: answer.body ?? "" };
  });
  return { request };
}

const publicRepo = {
  status: 200,
  body: '{"private":false,"default_branch":"main"}',
};
const manifest = {
  status: 200,
  body: encoded({
    id: "octo.notes",
    name: " Octo notes ",
    description: "Notes.",
  }),
};

it("parses repository names, folders, links and refs", () => {
  expect(parseSourceInput("octo/notes")).toEqual({
    owner: "octo",
    repo: "notes",
    path: "",
  });
  expect(
    parseSourceInput("https://github.com/octo/notes.git/tree/v1/plugins/a/"),
  ).toEqual({ owner: "octo", repo: "notes", ref: "v1", path: "plugins/a" });
  expect(parseSourceInput("octo/notes/plugins", " dev ")).toEqual({
    owner: "octo",
    repo: "notes",
    ref: "dev",
    path: "plugins",
  });
  expect(parseSourceInput("octo")).toBeNull();
  expect(parseSourceInput("octo/notes/../x")).toBeNull();
  expect(parseSourceInput("octo/notes", "bad..ref")).toBeNull();
  expect(describeSource({ owner: "o", repo: "r", path: "p" })).toBe("o/r/p");
});

it("finds a built plugin through GitHub's API on the default branch", async () => {
  const host = fakeHost({
    [api]: publicRepo,
    [`${api}/contents/plugins/notes/manifest.json?ref=main`]: manifest,
    [`${api}/contents/plugins/notes/plugin.js?ref=main`]: { status: 200 },
  });
  const result = await checkSource(host, {
    owner: "octo",
    repo: "notes",
    path: "plugins/notes",
  });
  expect(result).toEqual({
    ok: true,
    source: {
      owner: "octo",
      repo: "notes",
      ref: "main",
      path: "plugins/notes",
      id: "octo.notes",
      name: "Octo notes",
      description: "Notes.",
    },
  });
  expect(
    host.request.mock.calls.every(([input]) =>
      input.url.startsWith("https://api.github.com/"),
    ),
  ).toBe(true);
  expect(host.request.mock.calls.at(-1)?.[0]).toMatchObject({ method: "HEAD" });
});

it.each([
  [{ [api]: { status: 404 } }, "GitHub can't find octo/notes"],
  [{ [api]: { status: 200, body: '{"private":true}' } }, "is private"],
  [
    { [api]: publicRepo },
    "There's no manifest.json in the repository root on main",
  ],
  [
    {
      [api]: publicRepo,
      [`${api}/contents/manifest.json?ref=main`]: {
        status: 200,
        body: encoded({ id: "Bad Id", name: "x" }),
      },
    },
    "manifest.json needs an id",
  ],
  [
    {
      [api]: publicRepo,
      [`${api}/contents/manifest.json?ref=main`]: manifest,
    },
    "There's no plugin.js next to manifest.json on main",
  ],
  [{ [api]: { status: 403 } }, "Try again in a few minutes"],
])("explains why a source can't be listed", async (answers, message) => {
  const result = await checkSource(fakeHost(answers), {
    owner: "octo",
    repo: "notes",
    path: "",
  });
  expect(result.ok).toBe(false);
  expect(!result.ok && result.message).toContain(message);
});

const source = {
  owner: "octo",
  repo: "notes",
  ref: "main",
  path: "",
  id: "octo.notes",
  name: "Octo notes",
  description: "",
};

it("submits a checked source to the configured index", async () => {
  const host = fakeHost({
    [`${origin}/v1/sources`]: {
      status: 200,
      body: '{"status":"queued","listing":{"slug":"octo-notes","name":"Octo notes"}}',
    },
  });
  expect(await submitSource(host, origin, source)).toEqual({
    ok: true,
    status: "queued",
    slug: "octo-notes",
    name: "Octo notes",
  });
  expect(host.request).toHaveBeenCalledWith(
    expect.objectContaining({
      url: `${origin}/v1/sources`,
      method: "POST",
      body: JSON.stringify({ repository: "octo/notes", ref: "main" }),
    }),
  );
});

it.each([
  [
    {
      status: 422,
      body: '{"reason":"denylisted","detail":"It is denylisted."}',
    },
    "The index couldn't list it: It is denylisted.",
  ],
  [{ status: 429 }, "Try again tomorrow"],
  [{ status: 503 }, "couldn't check GitHub just now"],
  [{ status: 500 }, "HTTP 500"],
])("reports an index that doesn't accept a source", async (answer, message) => {
  const host = fakeHost({ [`${origin}/v1/sources`]: answer });
  const result = await submitSource(host, origin, source);
  expect(!result.ok && result.message).toContain(message);
});

it("sends nothing without a configured index", async () => {
  const host = fakeHost({});
  expect((await submitSource(host, "", source)).ok).toBe(false);
  expect(host.request).not.toHaveBeenCalled();
});
