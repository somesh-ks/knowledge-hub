import { access } from "node:fs/promises";
import { join } from "node:path";
import { serializeDigestFile } from "@dispatch/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitAndPush, DEFAULT_BOT } from "../src/git/commit.js";
import { createGitRunner } from "../src/git/runGit.js";
import { digestFor, must } from "./audio-fixtures.js";
import type { RepoPair } from "./git-testRepo.js";
import {
  commitAll,
  createRepoPair,
  git,
  localGitConfig,
  put,
  SEED_DIGEST_ID,
  SEED_DIGEST_PATH,
  spyRunner,
} from "./git-testRepo.js";

let pair: RepoPair;
beforeEach(async () => {
  pair = await createRepoPair();
});
afterEach(async () => {
  await pair.cleanup();
});

const head = (root: string): string => git(root, "rev-parse", "HEAD");
const remoteHead = (): string => git(pair.remote, "rev-parse", "refs/heads/main");
const stagedFiles = (root: string): string => git(root, "diff", "--cached", "--name-only");
const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

const MESSAGE = "chore(digest): 2026-10-07";

describe("commitAndPush: what it commits", () => {
  it("reports nothing to commit on a clean tree", async () => {
    expect(
      await commitAndPush({ root: pair.a, message: MESSAGE, command: "run", push: false }),
    ).toEqual({
      status: "nothing_to_commit",
    });
  });

  it("commits allowed changes for run", async () => {
    await put(
      pair.a,
      "Digests/2026/10/2026-10-07.md",
      serializeDigestFile(digestFor("2026-10-07")),
    );
    await put(pair.a, "state/seen.json", '{ "version": 1, "items": { "a": "2026-10-07" } }\n');
    const before = head(pair.a);
    const outcome = await commitAndPush({
      root: pair.a,
      message: MESSAGE,
      command: "run",
      push: false,
    });
    expect(outcome).toMatchObject({
      status: "committed",
      paths: ["Digests/2026/10/2026-10-07.md", "state/seen.json"],
    });
    expect(head(pair.a)).not.toBe(before);
    expect(git(pair.a, "log", "-1", "--format=%s")).toBe(MESSAGE);
    expect(git(pair.a, "show", "--name-only", "--format=", "HEAD").split("\n").sort()).toEqual([
      "Digests/2026/10/2026-10-07.md",
      "state/seen.json",
    ]);
    expect(git(pair.a, "status", "--porcelain")).toBe("");
  });

  it("returns the new commit's sha", async () => {
    await put(pair.a, "state/seen.json", "{}\n");
    const outcome = await commitAndPush({
      root: pair.a,
      message: MESSAGE,
      command: "run",
      push: false,
    });
    expect(outcome.status === "committed" && outcome.sha).toBe(head(pair.a));
  });

  it("commits as the bot using -c flags, leaving repository config untouched", async () => {
    await put(pair.a, "state/seen.json", "{}\n");
    await commitAndPush({ root: pair.a, message: MESSAGE, command: "run", push: false });
    expect(git(pair.a, "log", "-1", "--format=%an|%ae|%cn|%ce")).toBe(
      `${DEFAULT_BOT.name}|${DEFAULT_BOT.email}|${DEFAULT_BOT.name}|${DEFAULT_BOT.email}`,
    );
    expect(DEFAULT_BOT).toEqual({
      name: "dispatch-bot",
      email: "dispatch-bot@users.noreply.github.com",
    });
    expect(localGitConfig(pair.a, "user.name")).toBe("");
    expect(localGitConfig(pair.a, "user.email")).toBe("");
  });

  it("uses a configured identity", async () => {
    await put(pair.a, "state/seen.json", "{}\n");
    await commitAndPush({
      root: pair.a,
      message: MESSAGE,
      command: "run",
      push: false,
      identity: { name: "Custom Bot", email: "custom@example.com" },
    });
    expect(git(pair.a, "log", "-1", "--format=%an|%ae")).toBe("Custom Bot|custom@example.com");
  });

  it("keeps a multi-line message intact", async () => {
    await put(pair.a, "state/seen.json", "{}\n");
    await commitAndPush({
      root: pair.a,
      message: "chore(digest): 2026-10-07\n\nThree sources failed.",
      command: "run",
      push: false,
    });
    expect(git(pair.a, "log", "-1", "--format=%B")).toBe(
      "chore(digest): 2026-10-07\n\nThree sources failed.",
    );
  });

  it("commits a deletion", async () => {
    await access(join(pair.a, "state/seen.json"));
    git(pair.a, "rm", "-q", "state/seen.json");
    const outcome = await commitAndPush({
      root: pair.a,
      message: MESSAGE,
      command: "run",
      push: false,
    });
    expect(outcome.status).toBe("committed");
    expect(await exists(join(pair.a, "state/seen.json"))).toBe(false);
  });

  it("commits a rename inside the allowlist with both ends staged", async () => {
    git(pair.a, "mv", SEED_DIGEST_PATH, "Digests/2026/10/renamed.md");
    const outcome = await commitAndPush({
      root: pair.a,
      message: MESSAGE,
      command: "run",
      push: false,
    });
    expect(outcome).toMatchObject({ status: "committed" });
    expect(git(pair.a, "show", "--name-status", "--format=", "-M", "HEAD")).toMatch(
      /^R\d+\s+Digests\/2026\/10\/2026-10-05\.md\s+Digests\/2026\/10\/renamed\.md$/,
    );
  });

  it("commits file names with spaces and non-ASCII characters", async () => {
    await put(pair.a, "state/with space.json", "{}\n");
    await put(pair.a, "state/\u00FCn\u00EFcode.json", "{}\n");
    const outcome = await commitAndPush({
      root: pair.a,
      message: MESSAGE,
      command: "run",
      push: false,
    });
    expect(outcome.status).toBe("committed");
    expect(git(pair.a, "status", "--porcelain")).toBe("");
  });

  it("treats glob characters in a file name literally", async () => {
    await put(pair.a, "state/[bracket].json", "{}\n");
    await put(pair.a, "state/b.json", "{}\n");
    const outcome = await commitAndPush({
      root: pair.a,
      message: MESSAGE,
      command: "run",
      push: false,
    });
    expect(outcome.status).toBe("committed");
    expect(git(pair.a, "status", "--porcelain")).toBe("");
  });

  it("commits files inside a new untracked directory", async () => {
    await put(pair.a, "state/runs/2026-10-07/log.json", "{}\n");
    expect(
      (await commitAndPush({ root: pair.a, message: MESSAGE, command: "run", push: false })).status,
    ).toBe("committed");
    expect(git(pair.a, "ls-files", "state/runs")).toBe("state/runs/2026-10-07/log.json");
  });

  it("does not push unless asked", async () => {
    await put(pair.a, "state/seen.json", "{}\n");
    const before = remoteHead();
    await commitAndPush({ root: pair.a, message: MESSAGE, command: "run", push: false });
    expect(remoteHead()).toBe(before);
  });
});

describe("commitAndPush: the write guard", () => {
  it("refuses a change outside the allowlist and stages nothing", async () => {
    await put(pair.a, "config/preferences.json", '{"weights":{}}\n');
    const before = head(pair.a);
    const outcome = await commitAndPush({
      root: pair.a,
      message: MESSAGE,
      command: "run",
      push: false,
    });
    expect(outcome).toEqual({
      status: "refused",
      reason: "guard",
      offending: ["config/preferences.json"],
    });
    expect(head(pair.a)).toBe(before);
    expect(stagedFiles(pair.a)).toBe("");
  });

  it("refuses the whole commit when one path is allowed and another is not", async () => {
    await put(pair.a, "state/seen.json", '{ "version": 1, "items": { "x": "2026-10-07" } }\n');
    await put(pair.a, "package.json", '{"name":"tampered"}\n');
    const before = head(pair.a);
    const outcome = await commitAndPush({
      root: pair.a,
      message: MESSAGE,
      command: "run",
      push: true,
    });
    expect(outcome).toMatchObject({
      status: "refused",
      reason: "guard",
      offending: ["package.json"],
    });
    expect(head(pair.a)).toBe(before);
    expect(stagedFiles(pair.a)).toBe("");
    expect(remoteHead()).toBe(before);
  });

  it("refuses an untracked file outside the allowlist", async () => {
    await put(pair.a, ".env", "SECRET=1\n");
    await put(pair.a, "state/seen.json", "{}\n");
    const outcome = await commitAndPush({
      root: pair.a,
      message: MESSAGE,
      command: "run",
      push: false,
    });
    expect(outcome).toMatchObject({ status: "refused", offending: [".env"] });
  });

  it("refuses an out-of-allowlist change that was already staged", async () => {
    await put(pair.a, "package.json", '{"x":1}\n');
    git(pair.a, "add", "package.json");
    await put(pair.a, "state/seen.json", "{}\n");
    const outcome = await commitAndPush({
      root: pair.a,
      message: MESSAGE,
      command: "run",
      push: false,
    });
    expect(outcome).toMatchObject({ status: "refused", offending: ["package.json"] });
    expect(git(pair.a, "log", "-1", "--format=%s")).toBe("chore: seed");
  });

  it("refuses a rename that leaves the allowlist", async () => {
    git(pair.a, "mv", "state/seen.json", "config/seen.json");
    const outcome = await commitAndPush({
      root: pair.a,
      message: MESSAGE,
      command: "run",
      push: false,
    });
    expect(outcome).toMatchObject({ status: "refused", offending: ["config/seen.json"] });
  });

  it("refuses a rename into the allowlist from outside it", async () => {
    git(pair.a, "mv", "package.json", "state/package.json");
    const outcome = await commitAndPush({
      root: pair.a,
      message: MESSAGE,
      command: "run",
      push: false,
    });
    expect(outcome).toMatchObject({ status: "refused", offending: ["package.json"] });
  });

  it("refuses a tree stuck in an unresolved merge conflict", async () => {
    await put(
      pair.b,
      "state/usage.json",
      '{ "version": 1, "speechify": { "month": "2026-10", "characters": 1 } }\n',
    );
    await commitAll(pair.b, "chore: b usage");
    git(pair.b, "push", "-q", "origin", "main");
    await put(
      pair.a,
      "state/usage.json",
      '{ "version": 1, "speechify": { "month": "2026-10", "characters": 2 } }\n',
    );
    await commitAll(pair.a, "chore: a usage");
    try {
      git(pair.a, "pull", "--no-rebase", "origin", "main");
    } catch {
      // The conflict is the point.
    }
    const outcome = await commitAndPush({
      root: pair.a,
      message: "chore(audio): record speechify usage",
      command: "publish",
      push: false,
    });
    expect(outcome).toMatchObject({ status: "refused", reason: "guard" });
    expect(outcome.status === "refused" && outcome.offending).toContain(
      "state/usage.json (unmerged)",
    );
  });

  it("applies learn's list: preferences.json only", async () => {
    await put(pair.a, "config/preferences.json", '{"weights":{"a":1}}\n');
    expect(
      (
        await commitAndPush({
          root: pair.a,
          message: "feat(learn): shift weights",
          command: "learn",
          push: false,
        })
      ).status,
    ).toBe("committed");
    await put(pair.a, "state/seen.json", "{}\n");
    expect(
      (
        await commitAndPush({
          root: pair.a,
          message: "feat(learn): more",
          command: "learn",
          push: false,
        })
      ).status,
    ).toBe("refused");
  });

  it("applies publish's list: audio timelines, digests and usage only", async () => {
    await put(pair.a, "state/seen.json", "{}\n");
    const outcome = await commitAndPush({
      root: pair.a,
      message: "chore(audio): add narration",
      command: "publish",
      push: false,
    });
    expect(outcome).toMatchObject({ status: "refused", offending: ["state/seen.json"] });
  });

  it("lets publish commit a timeline, an audio-only digest rewrite and usage together", async () => {
    const digest = {
      ...digestFor(SEED_DIGEST_ID),
      audio: {
        url: "https://x.public.blob.vercel-storage.com/audio/2026-10-05.mp3",
        duration_ms: 1000,
      },
    };
    await put(pair.a, SEED_DIGEST_PATH, serializeDigestFile(digest));
    await put(pair.a, "Digests/2026/10/2026-10-05.audio.json", "{}\n");
    await put(
      pair.a,
      "state/usage.json",
      '{ "version": 1, "speechify": { "month": "2026-10", "characters": 4710 } }\n',
    );
    const outcome = await commitAndPush({
      root: pair.a,
      message: "chore(audio): add narration for 2026-10-05",
      command: "publish",
      push: false,
    });
    expect(outcome).toMatchObject({ status: "committed" });
  });

  it("refuses a publish that edits more than a digest's audio field", async () => {
    const tampered = digestFor(SEED_DIGEST_ID);
    tampered.items[0] = { ...must(tampered.items[0]), headline: "Rewritten by the audio step" };
    tampered.audio = {
      url: "https://x.public.blob.vercel-storage.com/audio/2026-10-05.mp3",
      duration_ms: 1000,
    };
    await put(pair.a, SEED_DIGEST_PATH, serializeDigestFile(tampered));
    const before = head(pair.a);
    const outcome = await commitAndPush({
      root: pair.a,
      message: "chore(audio): add narration",
      command: "publish",
      push: false,
    });
    expect(outcome).toMatchObject({ status: "refused", reason: "guard" });
    expect(outcome.status === "refused" && outcome.offending[0]).toContain(
      "changes more than the audio field",
    );
    expect(head(pair.a)).toBe(before);
    expect(stagedFiles(pair.a)).toBe("");
  });

  it("refuses a publish that adds a new digest", async () => {
    await put(
      pair.a,
      "Digests/2026/10/2026-10-07.md",
      serializeDigestFile(digestFor("2026-10-07")),
    );
    const outcome = await commitAndPush({
      root: pair.a,
      message: "chore(audio): add narration",
      command: "publish",
      push: false,
    });
    expect(outcome).toMatchObject({ status: "refused", reason: "guard" });
  });

  it("lets run commit digest changes freely, since the content check is publish's", async () => {
    const edited = digestFor(SEED_DIGEST_ID);
    edited.items[0] = { ...must(edited.items[0]), headline: "Edited by the run step" };
    await put(pair.a, SEED_DIGEST_PATH, serializeDigestFile(edited));
    expect(
      (await commitAndPush({ root: pair.a, message: MESSAGE, command: "run", push: false })).status,
    ).toBe("committed");
  });
});

describe("commitAndPush: message", () => {
  it.each(["update stuff", "Chore: capital", "chore:missing space", "chore(): empty scope", ""])(
    "refuses the non-conventional subject %j",
    async (message) => {
      await put(pair.a, "state/seen.json", "{}\n");
      const outcome = await commitAndPush({ root: pair.a, message, command: "run", push: false });
      expect(outcome).toMatchObject({ status: "refused", reason: "message" });
      expect(stagedFiles(pair.a)).toBe("");
    },
  );

  it.each([
    "feat: add thing",
    "fix(engine): handle 429",
    "chore(digest): 2026-10-07",
    "docs: update readme",
    "refactor(core)!: rename field",
    "ci: pin actions",
  ])("accepts %j", async (message) => {
    await put(pair.a, "state/seen.json", `{"v":"${message.length}"}\n`);
    expect(
      (await commitAndPush({ root: pair.a, message, command: "run", push: false })).status,
    ).toBe("committed");
  });
});

describe("commitAndPush: pushing", () => {
  it("pushes to the remote branch", async () => {
    await put(pair.a, "state/seen.json", '{ "version": 1, "items": { "p": "2026-10-07" } }\n');
    const outcome = await commitAndPush({
      root: pair.a,
      message: MESSAGE,
      command: "run",
      push: true,
    });
    expect(outcome).toMatchObject({ status: "pushed", retries: 0 });
    expect(remoteHead()).toBe(head(pair.a));
    expect(outcome.status === "pushed" && outcome.sha).toBe(remoteHead());
  });

  it("rebases onto a concurrent push and retries", async () => {
    await put(pair.b, "state/seen.json", '{ "version": 1, "items": { "b": "2026-10-07" } }\n');
    await commitAll(pair.b, "chore: concurrent change");
    git(pair.b, "push", "-q", "origin", "main");
    const concurrent = remoteHead();

    await put(
      pair.a,
      "Digests/2026/10/2026-10-07.md",
      serializeDigestFile(digestFor("2026-10-07")),
    );
    const outcome = await commitAndPush({
      root: pair.a,
      message: MESSAGE,
      command: "run",
      push: true,
    });

    expect(outcome).toMatchObject({ status: "pushed", retries: 1 });
    expect(remoteHead()).toBe(head(pair.a));
    expect(git(pair.remote, "log", "--format=%s", "-3", "refs/heads/main").split("\n")).toEqual([
      MESSAGE,
      "chore: concurrent change",
      "chore: seed",
    ]);
    expect(git(pair.remote, "rev-parse", "refs/heads/main~1")).toBe(concurrent);
    expect(outcome.status === "pushed" && outcome.sha).toBe(head(pair.a));
  });

  it("keeps the bot identity on the rebased commit", async () => {
    await put(pair.b, "state/seen.json", '{ "version": 1, "items": { "b": "x" } }\n');
    await commitAll(pair.b, "chore: concurrent change");
    git(pair.b, "push", "-q", "origin", "main");
    await put(
      pair.a,
      "Digests/2026/10/2026-10-07.md",
      serializeDigestFile(digestFor("2026-10-07")),
    );
    await commitAndPush({ root: pair.a, message: MESSAGE, command: "run", push: true });
    expect(git(pair.remote, "log", "-1", "--format=%an|%cn|%ce", "refs/heads/main")).toBe(
      `dispatch-bot|dispatch-bot|${DEFAULT_BOT.email}`,
    );
  });

  it("reports a conflicting state file, aborts the rebase and leaves the remote alone", async () => {
    await put(
      pair.b,
      "state/usage.json",
      '{ "version": 1, "speechify": { "month": "2026-10", "characters": 111 } }\n',
    );
    await commitAll(pair.b, "chore: other writer's usage");
    git(pair.b, "push", "-q", "origin", "main");
    const remoteAfterB = remoteHead();

    await put(
      pair.a,
      "state/usage.json",
      '{ "version": 1, "speechify": { "month": "2026-10", "characters": 999 } }\n',
    );
    const outcome = await commitAndPush({
      root: pair.a,
      message: "chore(audio): record speechify usage",
      command: "publish",
      push: true,
    });

    expect(outcome).toMatchObject({
      status: "push_failed",
      reason: "rebase_conflict",
      conflicts: ["state/usage.json"],
      retries: 0,
    });
    expect(remoteHead()).toBe(remoteAfterB);
    expect(await exists(join(pair.a, ".git", "rebase-merge"))).toBe(false);
    expect(await exists(join(pair.a, ".git", "rebase-apply"))).toBe(false);
    expect(git(pair.a, "log", "-1", "--format=%s")).toBe("chore(audio): record speechify usage");
    expect(git(pair.a, "status", "--porcelain")).toBe("");
  });

  it("says so when a conflicted rebase cannot be aborted", async () => {
    await put(
      pair.b,
      "state/usage.json",
      '{ "version": 1, "speechify": { "month": "2026-10", "characters": 5 } }\n',
    );
    await commitAll(pair.b, "chore: other usage");
    git(pair.b, "push", "-q", "origin", "main");
    await put(
      pair.a,
      "state/usage.json",
      '{ "version": 1, "speechify": { "month": "2026-10", "characters": 6 } }\n',
    );
    const stuck = { code: 1, stdout: "", stderr: "error: could not read the index" };
    const spy = spyRunner(pair.a, (args) => (args.includes("--abort") ? stuck : undefined));
    const outcome = await commitAndPush({
      root: pair.a,
      message: "chore(audio): record speechify usage",
      command: "publish",
      push: true,
      git: spy.run,
    });
    expect(outcome).toMatchObject({ status: "push_failed", reason: "error" });
    expect(outcome.status === "push_failed" && outcome.detail).toContain("left mid-rebase");
    expect(outcome.status === "push_failed" && outcome.conflicts).toEqual(["state/usage.json"]);
  });

  it("treats 'no rebase in progress' as a clean abort", async () => {
    const rejected = {
      code: 1,
      stdout: "",
      stderr: " ! [rejected]        main -> main (fetch first)",
    };
    const pullFailed = { code: 1, stdout: "", stderr: "fatal: unable to access the remote" };
    const noRebase = { code: 128, stdout: "", stderr: "fatal: No rebase in progress?" };
    const spy = spyRunner(pair.a, (args) => {
      if (args.includes("push")) return rejected;
      if (args.includes("pull")) return pullFailed;
      if (args.includes("--abort")) return noRebase;
      return undefined;
    });
    await put(pair.a, "state/seen.json", "{}\n");
    const outcome = await commitAndPush({
      root: pair.a,
      message: MESSAGE,
      command: "run",
      push: true,
      git: spy.run,
    });
    expect(outcome).toMatchObject({ status: "push_failed", reason: "error", conflicts: [] });
    expect(outcome.status === "push_failed" && outcome.detail).toContain("unable to access");
  });

  it("refuses a publish that renames a digest into an audio timeline name", async () => {
    git(pair.a, "mv", SEED_DIGEST_PATH, "Digests/2026/10/2026-10-05.audio.json");
    const before = head(pair.a);
    const outcome = await commitAndPush({
      root: pair.a,
      message: "chore(audio): add narration",
      command: "publish",
      push: false,
    });
    expect(outcome).toMatchObject({ status: "refused", reason: "guard" });
    expect(head(pair.a)).toBe(before);
  });

  // Windows reads the backslash as a separator when the file is created, so only POSIX can make it.
  it.skipIf(process.platform === "win32")(
    "refuses a file whose name holds a backslash instead of reading it as a directory",
    async () => {
      await put(pair.a, "Digests\\2026\\x.md", "x");
      const outcome = await commitAndPush({
        root: pair.a,
        message: "chore(audio): add narration",
        command: "publish",
        push: false,
      });
      expect(outcome).toMatchObject({ status: "refused", reason: "guard" });
    },
  );

  it("gives up after three retries when every push is rejected", async () => {
    const rejected = {
      code: 1,
      stdout: "",
      stderr: " ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs",
    };
    const spy = spyRunner(pair.a, (args) => (args.includes("push") ? rejected : undefined));
    await put(pair.a, "state/seen.json", "{}\n");
    const outcome = await commitAndPush({
      root: pair.a,
      message: MESSAGE,
      command: "run",
      push: true,
      git: spy.run,
    });
    expect(outcome).toMatchObject({ status: "push_failed", reason: "rejected", retries: 3 });
    expect(spy.of("push")).toHaveLength(4);
    expect(spy.of("pull")).toHaveLength(3);
  });

  it("honours a custom retry limit", async () => {
    const rejected = {
      code: 1,
      stdout: "",
      stderr: "! [rejected] main -> main (non-fast-forward)",
    };
    const spy = spyRunner(pair.a, (args) => (args.includes("push") ? rejected : undefined));
    await put(pair.a, "state/seen.json", "{}\n");
    const outcome = await commitAndPush({
      root: pair.a,
      message: MESSAGE,
      command: "run",
      push: true,
      git: spy.run,
      maxPushRetries: 1,
    });
    expect(outcome).toMatchObject({ status: "push_failed", reason: "rejected", retries: 1 });
    expect(spy.of("push")).toHaveLength(2);
  });

  it("does not rebase for a failure that is not a rejection", async () => {
    git(pair.a, "remote", "set-url", "origin", join(pair.remote, "..", "missing.git"));
    const spy = spyRunner(pair.a);
    await put(pair.a, "state/seen.json", "{}\n");
    const outcome = await commitAndPush({
      root: pair.a,
      message: MESSAGE,
      command: "run",
      push: true,
      git: spy.run,
    });
    expect(outcome).toMatchObject({ status: "push_failed", reason: "error", retries: 0 });
    expect(spy.of("pull")).toEqual([]);
    expect(spy.of("push")).toHaveLength(1);
    expect(git(pair.a, "log", "-1", "--format=%s")).toBe(MESSAGE);
  });

  it("never forces a push, even through retries", async () => {
    await put(pair.b, "state/seen.json", '{ "version": 1, "items": { "b": "y" } }\n');
    await commitAll(pair.b, "chore: concurrent change");
    git(pair.b, "push", "-q", "origin", "main");
    const spy = spyRunner(pair.a);
    await put(
      pair.a,
      "Digests/2026/10/2026-10-07.md",
      serializeDigestFile(digestFor("2026-10-07")),
    );
    await commitAndPush({
      root: pair.a,
      message: MESSAGE,
      command: "run",
      push: true,
      git: spy.run,
    });
    const everyArgument = spy.calls.flat();
    expect(everyArgument.some((arg) => /^--force|^-f$|^\+|--delete/.test(arg))).toBe(false);
    expect(spy.of("push")).toHaveLength(2);
  });

  it("pulls with --rebase and the bot identity", async () => {
    await put(pair.b, "state/seen.json", '{ "version": 1, "items": { "b": "z" } }\n');
    await commitAll(pair.b, "chore: concurrent change");
    git(pair.b, "push", "-q", "origin", "main");
    const spy = spyRunner(pair.a);
    await put(
      pair.a,
      "Digests/2026/10/2026-10-07.md",
      serializeDigestFile(digestFor("2026-10-07")),
    );
    await commitAndPush({
      root: pair.a,
      message: MESSAGE,
      command: "run",
      push: true,
      git: spy.run,
    });
    const pull = must(spy.of("pull")[0]);
    expect(pull).toContain("--rebase");
    expect(pull).toEqual(
      expect.arrayContaining([
        "-c",
        `user.name=${DEFAULT_BOT.name}`,
        `user.email=${DEFAULT_BOT.email}`,
      ]),
    );
  });

  it("reports a detached HEAD instead of pushing", async () => {
    git(pair.a, "checkout", "-q", "--detach");
    await put(pair.a, "state/seen.json", "{}\n");
    const spy = spyRunner(pair.a);
    const outcome = await commitAndPush({
      root: pair.a,
      message: MESSAGE,
      command: "run",
      push: true,
      git: spy.run,
    });
    expect(outcome).toMatchObject({ status: "push_failed", reason: "detached_head" });
    expect(spy.of("push")).toEqual([]);
  });

  it("pushes to a named remote", async () => {
    git(pair.a, "remote", "add", "mirror", pair.remote);
    await put(pair.a, "state/seen.json", '{ "version": 1, "items": { "m": "1" } }\n');
    const outcome = await commitAndPush({
      root: pair.a,
      message: MESSAGE,
      command: "run",
      push: true,
      remote: "mirror",
    });
    expect(outcome.status).toBe("pushed");
    expect(remoteHead()).toBe(head(pair.a));
  });

  it("runs against an injected runner for every git call", async () => {
    const spy = spyRunner(pair.a);
    await put(pair.a, "state/seen.json", "{}\n");
    await commitAndPush({
      root: pair.a,
      message: MESSAGE,
      command: "run",
      push: false,
      git: spy.run,
    });
    expect(spy.of("status")).toHaveLength(1);
    expect(spy.of("add")).toHaveLength(1);
    expect(spy.of("commit")).toHaveLength(1);
    expect(must(spy.of("add")[0])).toContain("--literal-pathspecs");
    expect(must(spy.of("commit")[0])).toEqual(
      expect.arrayContaining(["-c", "commit.gpgsign=false"]),
    );
    // Sanity: the shared runner is the real one.
    expect(createGitRunner(pair.a)).toBeTypeOf("function");
  });
});
