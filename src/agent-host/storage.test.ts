// @vitest-environment node
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readRecords, recordKey, writeRecord } from "../features/agents/store";
import { decodeKey, encodeKey, stateStorage } from "./storage";

it("names files as the app does", () => {
  // The same names as agent_state.rs `names_round_trip`.
  expect(encodeKey("buzz.agents.v1")).toBe("buzz.agents.v1");
  expect(encodeKey("buzz.codex.sessions.v4:wss://relay.example/a:ab")).toBe(
    "buzz.codex.sessions.v4%3Awss%3A%2F%2Frelay.example%2Fa%3Aab",
  );
  expect(encodeKey("a/b c%d")).toBe("a%2Fb%20c%25d");
  for (const key of ["buzz.agent.v1:ab", "a/b c%d", "é"])
    expect(decodeKey(encodeKey(key))).toBe(key);
  expect(decodeKey("x.tmp")).toBeUndefined();
  expect(decodeKey(".hidden")).toBeUndefined();
  expect(decodeKey("bad%Z")).toBeUndefined();
  expect(decodeKey("has space")).toBeUndefined();
});

it("reads what another program saved, and skips writes in progress", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "agent-state-")), "state");
  const storage = stateStorage(dir);
  expect(storage.getItem("missing")).toBeNull();
  expect(storage.length).toBe(0);
  const pubkey = "a".repeat(64);
  writeRecord(storage, { pubkey, attention: {}, config: { word: "one" } });
  // The app saves a change to the same file.
  writeFileSync(
    join(dir, encodeKey(recordKey(pubkey))),
    JSON.stringify({ pubkey, attention: {}, config: { word: "two" } }),
  );
  writeFileSync(join(dir, ".123.tmp"), "partial");
  expect(readRecords(storage)[pubkey]?.config).toEqual({ word: "two" });
  expect(storage.length).toBe(1);
  storage.removeItem(recordKey(pubkey));
  storage.removeItem(recordKey(pubkey));
  expect(readdirSync(dir)).toEqual([".123.tmp"]);
});
