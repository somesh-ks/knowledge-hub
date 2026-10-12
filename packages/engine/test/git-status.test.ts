import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isBehindRemote, isTreeClean } from "../src/git/status.js";
import type { RepoPair } from "./git-testRepo.js";
import { commitAll, createRepoPair, git, put } from "./git-testRepo.js";

let pair: RepoPair;
beforeEach(async () => {
  pair = await createRepoPair();
});
afterEach(async () => {
  await pair.cleanup();
});

describe("isTreeClean", () => {
  // One repository walked through every state: each step names what it checks.
  it("is false for any edit, stage, untracked file or deletion, and true once committed", async () => {
    const clean = () => isTreeClean(pair.a);
    expect(await clean(), "fresh clone").toBe(true);
    await put(pair.a, "state/seen.json", "{}\n");
    expect(await clean(), "edited tracked file").toBe(false);
    git(pair.a, "add", "state/seen.json");
    expect(await clean(), "staged change").toBe(false);
    await commitAll(pair.a, "chore: change");
    expect(await clean(), "committed").toBe(true);
    await put(pair.a, "notes.txt", "x");
    expect(await clean(), "untracked file").toBe(false);
    await rm(`${pair.a}/notes.txt`);
    await put(pair.a, "new/deep/file.txt", "x");
    expect(await clean(), "untracked file in a new directory").toBe(false);
    await rm(`${pair.a}/new`, { recursive: true });
    expect(await clean(), "back to clean").toBe(true);
    await rm(`${pair.a}/state/seen.json`);
    expect(await clean(), "deleted file").toBe(false);
    await expect(isTreeClean(`${pair.a}/../..`), "outside a repository").rejects.toThrow();
  });
});

describe("isBehindRemote", () => {
  it("is false when level with the remote", async () => {
    expect(await isBehindRemote(pair.a)).toBe(false);
  });

  it("is true after another clone pushes", async () => {
    await put(pair.b, "state/seen.json", '{ "version": 1, "items": { "b": "1" } }\n');
    await commitAll(pair.b, "chore: from b");
    git(pair.b, "push", "-q", "origin", "main");
    expect(await isBehindRemote(pair.a)).toBe(true);
  });

  it("is false once the local branch has caught up", async () => {
    await put(pair.b, "state/seen.json", '{ "version": 1, "items": { "b": "2" } }\n');
    await commitAll(pair.b, "chore: from b");
    git(pair.b, "push", "-q", "origin", "main");
    git(pair.a, "pull", "-q", "--ff-only", "origin", "main");
    expect(await isBehindRemote(pair.a)).toBe(false);
  });

  it("is false when only ahead of the remote", async () => {
    await put(pair.a, "state/seen.json", '{ "version": 1, "items": { "a": "1" } }\n');
    await commitAll(pair.a, "chore: local only");
    expect(await isBehindRemote(pair.a)).toBe(false);
  });

  it("is true when both sides have moved", async () => {
    await put(pair.b, "state/seen.json", '{ "version": 1, "items": { "b": "3" } }\n');
    await commitAll(pair.b, "chore: from b");
    git(pair.b, "push", "-q", "origin", "main");
    await put(
      pair.a,
      "state/usage.json",
      '{ "version": 1, "speechify": { "month": "2026-10", "characters": 5 } }\n',
    );
    await commitAll(pair.a, "chore: local");
    expect(await isBehindRemote(pair.a)).toBe(true);
  });

  it("is false for a branch the remote has never seen", async () => {
    git(pair.a, "checkout", "-q", "-b", "feature");
    expect(await isBehindRemote(pair.a)).toBe(false);
  });

  it("throws when the remote cannot be reached, since staleness must not read as up to date", async () => {
    git(pair.a, "remote", "set-url", "origin", `${pair.remote}-gone`);
    await expect(isBehindRemote(pair.a)).rejects.toThrow(/fetch failed/);
  });
});
