import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Logger } from "../src/context.js";
import { configBase } from "../src/git/configBase.js";
import { createGitRunner } from "../src/git/runGit.js";
import {
  ConfigConflict,
  hydrateConfig,
  SNAPSHOT_TRAILER,
  type SqlClient,
} from "../src/store/configDocs.js";
import { git } from "./git-testRepo.js";

const quiet: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const QUERIES = "config/queries.json";
const OLD = '{"queries":["changelog"]}\n';
const NEW = '{"queries":["decision","ai ux"]}\n';
const APP = '{"queries":["changelog","app edit"]}\n';

/** config_documents in memory: reads, and the versioned write writeConfigDocuments sends. */
function memoryStore(rows: { path: string; content: string; version: number }[]): SqlClient {
  return {
    query: async (text, params = []) => {
      if (text.startsWith("select path, content, version")) return rows.map((row) => ({ ...row }));
      const [paths, contents, versions, count] = params as [string[], string[], number[], number];
      const fine = paths.every(
        (path, i) => rows.find((r) => r.path === path)?.version === versions[i],
      );
      if (!fine) throw Object.assign(new Error("division by zero"), { code: "22012" });
      paths.forEach((path, i) => {
        const row = rows.find((r) => r.path === path);
        if (row) Object.assign(row, { content: contents[i], version: row.version + 1 });
      });
      return [{ written: count, at: 0 }];
    },
  };
}

/** A repo whose last snapshot run committed OLD, then a pull request that changes it to `edit`. */
async function repoEditedAfterSnapshot(edit: string | null): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "config-sync-"));
  await mkdir(join(root, "config"), { recursive: true });
  git(root, "init", "-q", "-b", "main");
  await writeFile(join(root, QUERIES), OLD);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", `chore(state): run 2026-10-24 nothing\n\n${SNAPSHOT_TRAILER}`);
  if (edit !== null) {
    await writeFile(join(root, QUERIES), edit);
    git(root, "commit", "-q", "-am", "chore(config): new queries (#263)");
  }
  return root;
}

async function hydrate(root: string, rows: { path: string; content: string; version: number }[]) {
  const base = await configBase(createGitRunner(root));
  return hydrateConfig(root, memoryStore(rows), quiet, base ?? undefined);
}

describe("hydrateConfig against the last snapshot", () => {
  // The bug (2026-10-25 weekly): a pull request changed config/queries.json after the store was
  // seeded, the run copied the store's older row over it, and the run's commit put the old queries
  // back on main. A repo-only edit now goes to the store; an app-only edit still comes from it.
  it("takes a repo-only edit into the store and keeps the file", async () => {
    const root = await repoEditedAfterSnapshot(NEW);
    const rows = [{ path: QUERIES, content: OLD, version: 3 }];
    expect(await hydrate(root, rows)).toEqual([QUERIES]);
    expect(await readFile(join(root, QUERIES), "utf8")).toBe(NEW);
    expect(rows).toEqual([{ path: QUERIES, content: NEW, version: 4 }]);
  });

  it("copies an app-only edit over the file, as before", async () => {
    const root = await repoEditedAfterSnapshot(null);
    const rows = [{ path: QUERIES, content: APP, version: 3 }];
    expect(await hydrate(root, rows)).toEqual([QUERIES]);
    expect(await readFile(join(root, QUERIES), "utf8")).toBe(APP);
    expect(rows[0]?.version).toBe(3);
  });

  it("stops on a file edited in both places, and writes neither", async () => {
    const root = await repoEditedAfterSnapshot(NEW);
    const rows = [{ path: QUERIES, content: APP, version: 3 }];
    await expect(hydrate(root, rows)).rejects.toBeInstanceOf(ConfigConflict);
    expect(await readFile(join(root, QUERIES), "utf8")).toBe(NEW);
    expect(rows).toEqual([{ path: QUERIES, content: APP, version: 3 }]);
  });
});
