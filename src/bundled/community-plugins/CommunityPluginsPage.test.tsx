// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { PluginInstaller } from "../../plugins/installer";
import { CommunityPluginsPage } from "./CommunityPluginsPage";
import { listing, rawIndex } from "./testing";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const origin = "https://plugins.example";
const popular = listing({
  key: "github.com/octo/popular",
  slug: "popular",
  id: "octo.popular",
  name: "Popular board",
  source: {
    repository: "https://github.com/octo/popular",
    ref: "main",
    commit: "b".repeat(40),
  },
  installs: { allTime: 40, last24h: 0, last7d: 0 },
  upvotes: 0,
});
const index = rawIndex([listing(), popular], {
  allTime: [popular.key, listing().key],
  mostUpvoted: [listing().key],
});

function setup(installer?: PluginInstaller) {
  const request = vi.fn(async ({ url }: { url: string }) => {
    if (url === `${origin}/v1/index.json`)
      return { status: 200, headers: {}, body: JSON.stringify(index) };
    if (url.startsWith("https://api.github.com/"))
      return { status: 200, headers: {}, body: '{"private":false}' };
    return { status: 202, headers: {}, body: "{}" };
  });
  const openPluginSettings = vi.fn();
  render(
    <CommunityPluginsPage
      origin={origin}
      host={{ request }}
      installer={installer}
      openPluginSettings={openPluginSettings}
    />,
  );
  return { request, openPluginSettings };
}

function fakeInstaller(
  result: Awaited<ReturnType<PluginInstaller["requestInstall"]>>,
) {
  let status: "installed" | "absent" = "absent";
  const listeners = new Set<() => void>();
  const installer: PluginInstaller = {
    requestInstall: vi.fn(async () => {
      if (result === "installed") {
        status = "installed";
        for (const listener of listeners) listener();
      }
      return result;
    }),
    getInstallationStatus: () => status,
    subscribeInstallationStatus: (_id, listener) => {
      const wrapped = () => listener(status);
      listeners.add(wrapped);
      return () => listeners.delete(wrapped);
    },
  };
  return installer;
}

it("explains a build without an index and makes no requests", async () => {
  const openPluginSettings = vi.fn();
  render(
    <CommunityPluginsPage
      origin=""
      host={{ request: vi.fn() }}
      installer={undefined}
      openPluginSettings={openPluginSettings}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "No community index configured" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Refresh community plugins" }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "Add your plugin" })).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "Open plugin settings" }),
  );
  expect(openPluginSettings).toHaveBeenCalled();
});

it("lists plugins by installs with counts, and filters to a search", async () => {
  setup();
  const rows = await screen.findAllByRole("button", { name: /^Open / });
  expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
    "Open Popular board",
    "Open Octo notes",
  ]);
  expect(screen.getByText("Added by 40 people")).toBeInTheDocument();
  expect(screen.getByText("4 upvotes")).toBeInTheDocument();
  await userEvent.type(
    screen.getByLabelText("Search community plugins"),
    "zzz",
  );
  expect(
    screen.getByRole("heading", { name: "No plugins match" }),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(screen.getAllByRole("button", { name: /^Open / })).toHaveLength(2);
});

it("shows a retry beside a failed index read", async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({
      status: 200,
      headers: {},
      body: JSON.stringify(index),
    });
  render(
    <CommunityPluginsPage
      origin={origin}
      host={{ request }}
      installer={undefined}
      openPluginSettings={vi.fn()}
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Buzz couldn't reach the community index.",
  );
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findAllByRole("button", { name: /^Open / })).toHaveLength(
    2,
  );
});

it("installs the indexed commit, counts it, then allows an upvote", async () => {
  const installer = fakeInstaller("installed");
  const { request } = setup(installer);
  await userEvent.click(
    await screen.findByRole("button", { name: "Open Octo notes" }),
  );
  const upvote = screen.getByRole("button", { name: "Upvote" });
  expect(upvote).toBeDisabled();
  expect(
    screen.getByText("Add it to Buzz from here to upvote it."),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Add to Buzz" }));
  expect(installer.requestInstall).toHaveBeenCalledWith({
    repository: "https://github.com/octo/notes-plugin",
    reference: "main",
    commit: "a".repeat(40),
  });
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Octo notes is installed and turned on.",
  );
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ url: `${origin}/v1/installs` }),
    ),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Upvote" })).toBeEnabled(),
  );
  await userEvent.click(screen.getByRole("button", { name: "Upvote" }));
  expect(
    await screen.findByRole("button", { name: "Upvoted" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("5 upvotes")).toBeInTheDocument();
});

it("sends no counts when sharing is turned off", async () => {
  const installer = fakeInstaller("installed");
  const { request } = setup(installer);
  await userEvent.click(
    await screen.findByRole("switch", {
      name: "Share anonymous install counts and upvotes",
    }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Open Octo notes" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Add to Buzz" }));
  await screen.findByRole("status");
  expect(request.mock.calls.map(([input]) => input.url)).toEqual([
    `${origin}/v1/index.json`,
  ]);
});

it("offers a retry when the install review closes without installing", async () => {
  const installer = fakeInstaller("cancelled");
  setup(installer);
  await userEvent.click(
    await screen.findByRole("button", { name: "Open Octo notes" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Add to Buzz" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The review closed before anything was installed.",
  );
  expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
});

it("checks a repository, submits it, and opens it when already listed", async () => {
  const { request } = setup();
  request.mockImplementation(async ({ url }: { url: string }) => {
    if (url === `${origin}/v1/index.json`)
      return { status: 200, headers: {}, body: JSON.stringify(index) };
    if (url === "https://api.github.com/repos/octo/popular")
      return {
        status: 200,
        headers: {},
        body: '{"private":false,"default_branch":"main"}',
      };
    if (url.endsWith("/manifest.json?ref=main"))
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          encoding: "base64",
          content: btoa('{"id":"octo.popular","name":"Popular board"}'),
        }),
      };
    if (url.endsWith("/plugin.js?ref=main"))
      return { status: 200, headers: {}, body: "" };
    if (url === `${origin}/v1/sources`)
      return {
        status: 200,
        headers: {},
        body: '{"status":"listed","listing":{"slug":"popular","name":"Popular board"}}',
      };
    return { status: 404, headers: {}, body: "" };
  });
  await userEvent.click(
    await screen.findByRole("button", { name: "Add your plugin" }),
  );
  const submit = screen.getByRole("button", { name: "Check and submit" });
  expect(submit).toBeDisabled();
  await userEvent.type(screen.getByLabelText("Repository"), "octo");
  await userEvent.click(submit);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Enter a GitHub repository",
  );
  await userEvent.clear(screen.getByLabelText("Repository"));
  await userEvent.type(
    screen.getByLabelText("Repository"),
    "https://github.com/octo/popular",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Check and submit" }),
  );
  expect(
    await screen.findByText("Popular board is already listed."),
  ).toBeInTheDocument();
  expect(
    screen.getByText("octo.popular · octo/popular @ main"),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "View listing" }));
  expect(
    screen.getByRole("heading", { name: "Popular board" }),
  ).toBeInTheDocument();
});

it("shows why GitHub rejected a repository and sends nothing to the index", async () => {
  const { request } = setup();
  await userEvent.click(
    await screen.findByRole("button", { name: "Add your plugin" }),
  );
  request.mockResolvedValue({
    status: 200,
    headers: {},
    body: '{"private":true}',
  });
  await userEvent.type(screen.getByLabelText("Repository"), "octo/secret");
  await userEvent.click(
    screen.getByRole("button", { name: "Check and submit" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "octo/secret is private. Only public repositories can be listed.",
  );
  expect(
    request.mock.calls.some(([input]) => input.url === `${origin}/v1/sources`),
  ).toBe(false);
  await userEvent.click(
    screen.getByRole("button", { name: "All community plugins" }),
  );
  expect(await screen.findAllByRole("button", { name: /^Open / })).toHaveLength(
    2,
  );
});
