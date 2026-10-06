import { rm } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { git } from "./git-testRepo.js";
import {
  buildTemplate,
  exists,
  goodFeeds,
  instantiate,
  makeWorld,
  readDigest,
  readJson,
  runStaged,
  runStage,
  type TestRepo,
  WED,
} from "./orchestrator-fixtures.js";

let template: string;
let repo: TestRepo;

beforeAll(async () => {
  template = await buildTemplate();
}, 120_000);
afterAll(async () => {
  await rm(template, { recursive: true, force: true, maxRetries: 3 });
});
beforeEach(async () => {
  repo = await instantiate(template);
}, 60_000);
afterEach(async () => {
  await repo.cleanup();
});

describe("published run", () => {
  it("runs staged and publishes one digest", { timeout: 90_000 }, async () => {
    const world = makeWorld(repo.root, { now: WED });
    const results = await runStaged(world);
    expect(results.map((r) => r.code)).toEqual([0, 0, 0, 0, 0, 0]);
    const commit = results[5]?.report;
    expect(commit).toMatchObject({ outcome: "published", deploy: true });
    expect(await exists(repo.root, "Digests/2026/10/2026-10-07.md")).toBe(true);
    const digest = await readDigest(repo.root, "Digests/2026/10/2026-10-07.md");
    expect(digest.items.length).toBeGreaterThanOrEqual(3);
    expect(git(repo.root, "log", "-1", "--format=%s")).toBe("chore(digest): 2026-10-07");
    expect(await readJson(repo.root, "state/last-run.json")).toBeTruthy();
  });
});
