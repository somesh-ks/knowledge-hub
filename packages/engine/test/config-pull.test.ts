import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeConfigCommand } from "../src/commands/config.js";
import { examplePath } from "../src/store/configExamples.js";
import { CONFIG_DOCUMENT_PATHS, type SqlClient } from "../src/store/configPaths.js";
import { captureStdout, makeContext } from "./curate-helpers.js";
import { REPO_ROOT } from "./score-factories.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "config-pull-"));
  for (const path of CONFIG_DOCUMENT_PATHS) {
    const target = join(root, examplePath(path));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readFile(join(REPO_ROOT, examplePath(path)), "utf8"));
  }
});
afterEach(() => rm(root, { recursive: true, force: true }));

const STORE_ENV = { DATABASE_URL: "postgres://fake", SINGULARITY_CONFIG_STORE: "postgres" };
const rows = (docs: Record<string, string>): SqlClient => ({
  query: async () => Object.entries(docs).map(([path, content]) => ({ path, content, version: 1 })),
});

async function pull(env: Record<string, string>, sql?: SqlClient): Promise<number> {
  const { ctx } = makeContext(root, { env, json: false });
  const run = makeConfigCommand({ connectConfigStore: async () => sql as SqlClient });
  return (await captureStdout(async () => run(["pull"], ctx))).result;
}

describe("singularity config pull (D296)", () => {
  // The bug it prevents: a build from a checkout with no owner config would ship pages of defaults,
  // or a fork would crash on the first missing file.
  it("takes the stored documents, fills the rest from the examples, and keeps no owner data in them", async () => {
    const stored = '{"version":1,"added":[{"id":"mine"}],"overrides":{}}\n';
    expect(await pull(STORE_ENV, rows({ "config/sources.user.json": stored }))).toBe(0);
    expect(await readFile(join(root, "config/sources.user.json"), "utf8")).toBe(stored);
    expect(await readFile(join(root, "config/queries.json"), "utf8")).toContain("queries");
  });

  it("with the store off copies the examples over the missing files only", async () => {
    await mkdir(join(root, "config"), { recursive: true });
    await writeFile(join(root, "config/queries.json"), '{"version":1,"queries":[]}\n');
    expect(await pull({})).toBe(0);
    expect(await readFile(join(root, "config/queries.json"), "utf8")).toBe(
      '{"version":1,"queries":[]}\n',
    );
    expect(await readFile(join(root, "config/preferences.json"), "utf8")).toContain("Your name");
  });

  it("stops when the store is down and files are missing", async () => {
    const down: SqlClient = {
      query: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    };
    expect(await pull(STORE_ENV, down)).toBe(1);
  });
});
