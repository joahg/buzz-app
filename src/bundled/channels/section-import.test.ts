import { expect, it } from "vitest";
import {
  normalizeChannelName,
  parseSectionOutline,
  planSectionImport,
} from "./section-import";

it("reads section names and #, bullet and indented channels", () => {
  expect(
    parseSectionOutline(
      [
        "Team:",
        "#agent-ops",
        "- #agent-autonomy",
        "",
        "Projects",
        "  buzz-dev",
        "• kgoose",
        "#",
      ].join("\n"),
    ),
  ).toEqual([
    { name: "Team", channels: ["#agent-ops", "#agent-autonomy"] },
    { name: "Projects", channels: ["buzz-dev", "kgoose"] },
  ]);
});

it("drops channels listed before any section name", () => {
  expect(parseSectionOutline("#orphan\nTeam\n#a")).toEqual([
    { name: "Team", channels: ["#a"] },
  ]);
});

it("matches names regardless of case, #, spaces and underscores", () => {
  expect(normalizeChannelName(" #Agent_Ops Team ")).toBe("agent-ops-team");
});

it("matches channels once, reuses sections and leaves starred channels", () => {
  expect(
    planSectionImport(
      [
        { name: "Team", channels: ["#Agent-Ops", "#missing", "#pinned"] },
        { name: "projects", channels: ["buzz_dev", "agent-ops"] },
        { name: "team", channels: ["#general"] },
      ],
      [
        { id: "c1", name: "agent-ops" },
        { id: "c2", name: "buzz-dev" },
        { id: "c3", name: "general" },
        { id: "c4", name: "pinned" },
      ],
      [{ id: "s1", name: "Projects" }],
      new Set(["c4"]),
    ),
  ).toEqual([
    {
      name: "Team",
      existingSectionId: undefined,
      channelIds: ["c1", "c3"],
      unmatched: ["missing"],
      starred: ["pinned"],
    },
    {
      name: "projects",
      existingSectionId: "s1",
      channelIds: ["c2"],
      unmatched: [],
      starred: [],
    },
  ]);
});
