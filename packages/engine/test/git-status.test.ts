import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GhRunner } from "../src/git/status.js";
import { hasRunInProgress, isBehindRemote, isTreeClean } from "../src/git/status.js";
import { must } from "./audio-fixtures.js";
import type { RepoPair } from "./git-testRepo.js";
import { commitAll, createRepoPair, git, put, spyRunner } from "./git-testRepo.js";

let pair: RepoPair;
beforeEach(async () => {
  pair = await createRepoPair();
});
afterEach(async () => {
  await pair.cleanup();
});

describe("isTreeClean", () => {
  it("is true for a fresh clone", async () => {
    expect(await isTreeClean(pair.a)).toBe(true);
  });

  it("is false after editing a tracked file", async () => {
    await put(pair.a, "state/seen.json", "{}\n");
    expect(await isTreeClean(pair.a)).toBe(false);
  });

  it("is false for an untracked file", async () => {
    await put(pair.a, "notes.txt", "x");
    expect(await isTreeClean(pair.a)).toBe(false);
  });

  it("is false for a staged change", async () => {
    await put(pair.a, "state/seen.json", "{}\n");
    git(pair.a, "add", "state/seen.json");
    expect(await isTreeClean(pair.a)).toBe(false);
  });

  it("is false for an untracked file inside a new directory", async () => {
    await put(pair.a, "new/deep/file.txt", "x");
    expect(await isTreeClean(pair.a)).toBe(false);
  });

  it("is true again once the change is committed", async () => {
    await put(pair.a, "state/seen.json", "{}\n");
    await commitAll(pair.a, "chore: change");
    expect(await isTreeClean(pair.a)).toBe(true);
  });

  it("is false for a deleted file", async () => {
    await rm(`${pair.a}/state/seen.json`);
    expect(await isTreeClean(pair.a)).toBe(false);
  });

  it("fails outside a repository instead of reporting clean", async () => {
    await expect(isTreeClean(`${pair.a}/../..`)).rejects.toThrow();
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

  it("fetches first by default and not when told otherwise", async () => {
    await put(pair.b, "state/seen.json", '{ "version": 1, "items": { "b": "4" } }\n');
    await commitAll(pair.b, "chore: from b");
    git(pair.b, "push", "-q", "origin", "main");
    expect(await isBehindRemote(pair.a, { fetch: false })).toBe(false);
    const spy = spyRunner(pair.a);
    expect(await isBehindRemote(pair.a, { git: spy.run })).toBe(true);
    expect(spy.of("fetch")).toHaveLength(1);
  });

  it("is false for a branch the remote has never seen", async () => {
    git(pair.a, "checkout", "-q", "-b", "feature");
    expect(await isBehindRemote(pair.a)).toBe(false);
  });

  it("checks a named branch", async () => {
    expect(await isBehindRemote(pair.a, { branch: "nonexistent" })).toBe(false);
    await put(pair.b, "state/seen.json", '{ "version": 1, "items": { "b": "5" } }\n');
    await commitAll(pair.b, "chore: from b");
    git(pair.b, "push", "-q", "origin", "main");
    expect(await isBehindRemote(pair.a, { branch: "main" })).toBe(true);
  });

  it("throws when the remote cannot be reached, since staleness must not read as up to date", async () => {
    git(pair.a, "remote", "set-url", "origin", `${pair.remote}-gone`);
    await expect(isBehindRemote(pair.a)).rejects.toThrow(/fetch failed/);
  });
});

describe("hasRunInProgress", () => {
  const answer =
    (...statuses: string[]): GhRunner =>
    async () => ({
      code: 0,
      stdout: JSON.stringify(statuses.map((status) => ({ status }))),
      stderr: "",
    });

  it("is true while a run is in progress", async () => {
    expect(await hasRunInProgress(answer("completed", "in_progress"))).toBe(true);
  });

  it.each(["queued", "waiting", "pending", "requested"])(
    "is true for a %s run, which will start soon",
    async (status) => {
      expect(await hasRunInProgress(answer(status))).toBe(true);
    },
  );

  it("is false when every run has completed", async () => {
    expect(await hasRunInProgress(answer("completed", "completed"))).toBe(false);
  });

  it("is false when there are no runs", async () => {
    expect(await hasRunInProgress(answer())).toBe(false);
  });

  it("is false for empty output", async () => {
    expect(await hasRunInProgress(async () => ({ code: 0, stdout: "", stderr: "" }))).toBe(false);
  });

  it("asks gh for the run workflow's runs as JSON", async () => {
    const seen: (readonly string[])[] = [];
    await hasRunInProgress(async (args) => {
      seen.push(args);
      return { code: 0, stdout: "[]", stderr: "" };
    });
    expect(must(seen[0])).toEqual([
      "run",
      "list",
      "--workflow",
      "run.yml",
      "--limit",
      "20",
      "--json",
      "status",
    ]);
  });

  it("passes a custom workflow and repository through", async () => {
    const seen: (readonly string[])[] = [];
    await hasRunInProgress(
      async (args) => {
        seen.push(args);
        return { code: 0, stdout: "[]", stderr: "" };
      },
      { workflow: "other.yml", repo: "owner/name" },
    );
    expect(must(seen[0])).toEqual([
      "run",
      "list",
      "--workflow",
      "other.yml",
      "--limit",
      "20",
      "--json",
      "status",
      "--repo",
      "owner/name",
    ]);
  });

  it("throws when gh fails, so an unknown answer is never read as idle", async () => {
    await expect(
      hasRunInProgress(async () => ({ code: 4, stdout: "", stderr: "gh: not logged in" })),
    ).rejects.toThrow(/gh run list failed \(exit 4\): gh: not logged in/);
  });

  it("throws on output that is not a run list", async () => {
    await expect(
      hasRunInProgress(async () => ({ code: 0, stdout: '{"oops":true}', stderr: "" })),
    ).rejects.toThrow();
  });
});
