import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makePodcastCommand } from "../src/commands/podcast.js";
import { commitAndPush } from "../src/git/commit.js";
import { ALLOWLISTS, findViolations, isPathAllowed } from "../src/git/guard.js";
import { captureStdout, makeContext } from "./curate-helpers.js";
import { commitAll, createRepoPair, git, put, type RepoPair } from "./git-testRepo.js";
import {
  dayAgo,
  FakeScriptWriter,
  makeDigest,
  NOW,
  REQUEST,
  writeDigest,
} from "./podcast-fixtures.js";

describe("the podcast allowlist", () => {
  it("allows Podcasts/ and the cost ledger and nothing else", () => {
    expect(ALLOWLISTS.podcast).toEqual([
      "Podcasts/",
      "state/costs-*.json",
      "state/podcast-timings.json",
    ]);
    expect(isPathAllowed("Podcasts/2026/10/ep-20261008-0913.md", ALLOWLISTS.podcast)).toBe(true);
    for (const path of [
      "Digests/2026/10/2026-10-08.md",
      "state/usage.json",
      "config/preferences.json",
      ".github/workflows/podcast.yml",
      "PodcastsX/a.md",
      "Podcasts",
      "Podcasts/../state/seen.json",
      "Podcasts\\a.md",
    ]) {
      expect(isPathAllowed(path, ALLOWLISTS.podcast)).toBe(false);
    }
  });

  it("reports every path outside it", () => {
    expect(findViolations(["Podcasts/a.md", "state/seen.json"], ALLOWLISTS.podcast)).toEqual([
      "state/seen.json",
    ]);
  });
});

describe("singularity podcast", () => {
  let pair: RepoPair;
  let root: string;

  beforeEach(async () => {
    pair = await createRepoPair({ seedDigest: false });
    root = pair.a;
    for (const days of [1, 2]) {
      const when = dayAgo(days);
      const digest = makeDigest(when.id, when.at, [{ n: days * 10 }, { n: days * 10 + 1 }]);
      await writeDigest(root, digest);
    }
    await commitAll(root, "chore: seed digests");
  });
  afterEach(async () => {
    await pair.cleanup();
  });

  async function runPodcast(
    argv: string[],
    writer = new FakeScriptWriter(),
  ): Promise<{ code: number; stdout: string; writer: FakeScriptWriter; errors: string[] }> {
    const { ctx, logs } = makeContext(root, { json: false });
    const command = makePodcastCommand({ makeWriter: () => writer });
    const { result, stdout } = await captureStdout(() => command(argv, ctx));
    return {
      code: result,
      stdout,
      writer,
      errors: logs.filter((l) => l.level === "error").map((l) => l.message),
    };
  }

  const args = (request: unknown = REQUEST): string[] => [
    "--request",
    JSON.stringify(request),
    "--now",
    NOW.toISOString(),
    "--no-push",
  ];

  it("writes the episode, commits it as feat(podcast) and prints the id last", async () => {
    const { code, stdout, writer } = await runPodcast(args());
    expect(code).toBe(0);
    expect(writer.calls).toHaveLength(1);
    const lines = stdout.trimEnd().split("\n");
    expect(lines.at(-1)).toBe("ep-20261008-0913");
    expect(git(root, "log", "-1", "--format=%s")).toBe("feat(podcast): add ep-20261008-0913");
    expect(git(root, "show", "--name-only", "--format=", "HEAD")).toBe(
      "Podcasts/2026/10/ep-20261008-0913.md",
    );
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  // A failed voice or publish step used to throw the script away, and Try again paid for it twice.
  it("resumes: a stage that finished is not run again, and publish commits the saved script", async () => {
    const dir = join(root, "..", `stages-${Date.now()}`);
    const step = (stage: string, writer = new FakeScriptWriter()) =>
      runPodcast([...args(), "--stage", stage, "--artifacts", dir], writer);
    for (const stage of ["select", "cover", "script"]) {
      expect((await step(stage)).code).toBe(0);
    }
    const again = await step("script");
    expect(again.code).toBe(0);
    expect(again.writer.calls).toHaveLength(0);
    const published = await step("publish");
    expect(published.code).toBe(0);
    expect(published.writer.calls).toHaveLength(0);
    expect(git(root, "log", "-1", "--format=%s")).toBe("feat(podcast): add ep-20261008-0913");
    expect(git(root, "show", "--name-only", "--format=", "HEAD")).toContain(
      "state/podcast-timings.json",
    );
  });

  // A run that stopped between the select and cover saves left the script step failing on the cover.
  it("resumes the script step when the cover was never saved", async () => {
    const dir = join(root, "..", `no-cover-${Date.now()}`);
    const step = (stage: string) => runPodcast([...args(), "--stage", stage, "--artifacts", dir]);
    expect((await step("select")).code).toBe(0);
    await rm(join(dir, "cover.json"));
    expect((await step("script")).code).toBe(0);
  });

  it("prints one JSON line with --json", async () => {
    const { ctx } = makeContext(root, { json: true });
    const command = makePodcastCommand({ makeWriter: () => new FakeScriptWriter() });
    const { result, stdout } = await captureStdout(() => command(args(), ctx));
    expect(result).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      outcome: "committed",
      episode_id: "ep-20261008-0913",
      path: "Podcasts/2026/10/ep-20261008-0913.md",
    });
  });

  it("refuses an invalid request before touching anything", async () => {
    const { code, errors, writer } = await runPodcast(args({ ...REQUEST, length_minutes: 4 }));
    expect(code).toBe(2);
    expect(errors.join(" ")).toMatch(/length_minutes/);
    expect(writer.calls).toHaveLength(0);
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("fails without calling the writer when a chosen topic has no stories", async () => {
    const { code, errors, writer } = await runPodcast(
      args({ ...REQUEST, topic_ids: ["launches"] }),
    );
    expect(code).toBe(1);
    expect(errors.join(" ")).toMatch(/No stories in Launches in the last 7 days\./);
    expect(writer.calls).toHaveLength(0);
  });

  it("needs --request", async () => {
    const { code } = await runPodcast(["--no-push"]);
    expect(code).toBe(2);
  });

  it("refuses to commit when something outside Podcasts/ changed", async () => {
    await put(root, "notes.txt", "stray");
    const { code, errors } = await runPodcast(args());
    expect(code).toBe(1);
    expect(errors.join(" ")).toMatch(/Commit refused \(guard\).*notes\.txt/);
    expect(git(root, "log", "-1", "--format=%s")).toBe("chore: seed digests");
  });
});

describe("commitAndPush as podcast", () => {
  it("commits Podcasts/ and refuses anything else", async () => {
    const pair = await createRepoPair({ seedDigest: false });
    try {
      await put(pair.a, "Podcasts/2026/10/ep-20261008-0913.md", "x\n");
      const ok = await commitAndPush({
        root: pair.a,
        message: "feat(podcast): add ep-20261008-0913",
        command: "podcast",
        push: false,
      });
      expect(ok.status).toBe("committed");

      await put(pair.a, "Podcasts/2026/10/ep-20261008-0914.md", "y\n");
      await put(pair.a, "state/seen.json", "{}\n");
      const refused = await commitAndPush({
        root: pair.a,
        message: "feat(podcast): add ep-20261008-0914",
        command: "podcast",
        push: false,
      });
      expect(refused).toMatchObject({ status: "refused", reason: "guard" });
      expect(refused.status === "refused" && refused.offending).toEqual(["state/seen.json"]);
    } finally {
      await pair.cleanup();
    }
  });
});
