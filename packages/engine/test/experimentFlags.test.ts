import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadAlexandriaConfig } from "../src/alexandria/alexandria.js";
import { loadCommunity } from "../src/community/community.js";
import type { Logger } from "../src/context.js";
import { cacheExperimentFlags } from "../src/experiments/overrides.js";
import type { SqlClient } from "../src/store/configPaths.js";
import { loadTrustedPublishers } from "../src/trustedPublishers/trustedPublishers.js";

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "experiment-flags-"));
  await mkdir(join(root, "config"), { recursive: true });
  await writeFile(
    join(root, "config/trusted-publishers.json"),
    JSON.stringify({ version: 1, enabled: false, entries: [] }),
  );
  await writeFile(
    join(root, "config/community.json"),
    JSON.stringify({
      version: 1,
      enabled: false,
      min_votes: 150,
      full_votes: 1500,
      max_depth: 0.25,
    }),
  );
  await writeFile(join(root, "config/alexandria.json"), JSON.stringify({ enabled: true }));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const store = (rows: Record<string, unknown>[]): SqlClient => ({ query: async () => rows });

describe("the owner's experiment switches (admin app, stored in Neon)", () => {
  // The switch must reach the engine with no commit: a row overrides the file, and no row leaves it.
  it("a stored switch overrides each experiment's config file for the run, and no row does not", async () => {
    await cacheExperimentFlags(
      root,
      store([
        { id: "community-ranking", enabled: true, promoted_at: null },
        { id: "alexandria", enabled: false, promoted_at: null },
      ]),
      silent,
    );
    expect((await loadCommunity(root)).enabled).toBe(true);
    expect((await loadAlexandriaConfig(root)).enabled).toBe(false);
    expect((await loadTrustedPublishers(root)).enabled).toBe(false);
  });

  // A store that cannot be read must cost the switches, not the run, and leave no stale cache.
  it("a store that cannot be read leaves the files in charge", async () => {
    await cacheExperimentFlags(
      root,
      store([{ id: "community-ranking", enabled: true, promoted_at: null }]),
      silent,
    );
    const broken: SqlClient = {
      query: async () => {
        throw new Error("connection refused");
      },
    };
    await cacheExperimentFlags(root, broken, silent);
    expect((await loadCommunity(root)).enabled).toBe(false);
    await expect(readFile(join(root, ".cache/experiment-flags.json"))).rejects.toThrow();
  });
});
