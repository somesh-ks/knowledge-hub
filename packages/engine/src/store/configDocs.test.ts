import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Logger } from "../context.js";
import { hydrateConfig, type SqlClient } from "./configDocs.js";

const quiet: Logger = { debug() {}, info() {}, warn() {}, error() {} };

function fakeStore(rows: { path: string; content: string }[]): SqlClient {
  return { query: async () => rows.map((row) => ({ ...row, version: 1 })) };
}

async function exists(path: string): Promise<boolean> {
  return readFile(path, "utf8").then(
    () => true,
    () => false,
  );
}

describe("hydrateConfig", () => {
  // The bug: the engine writes whatever a row names. A stray or hostile row could overwrite `.env`,
  // a digest, or a file outside the checkout, and a row that is not JSON would break every loader
  // for the run. Only the listed config files, and only valid JSON, may replace a committed file.
  it("writes only listed config files that hold JSON, and keeps files the store has no row for", async () => {
    const root = await mkdtemp(join(tmpdir(), "config-store-"));
    await mkdir(join(root, "config"), { recursive: true });
    await writeFile(join(root, "config/schedule.json"), '{"hour":7}\n');
    await writeFile(join(root, "config/preferences.json"), '{"weights":{}}\n');

    const changed = await hydrateConfig(
      root,
      fakeStore([
        { path: "config/topics.json", content: '{"topics":[]}\n' },
        { path: "config/schedule.json", content: "{not json" },
        { path: ".env", content: '{"stolen":true}' },
        { path: `../${basename(root)}-outside.json`, content: "{}" },
        { path: "Digests/2026/x.json", content: "{}" },
      ]),
      quiet,
    );

    expect(changed).toEqual(["config/topics.json"]);
    expect(await readFile(join(root, "config/topics.json"), "utf8")).toBe('{"topics":[]}\n');
    expect(await readFile(join(root, "config/schedule.json"), "utf8")).toBe('{"hour":7}\n');
    expect(await readFile(join(root, "config/preferences.json"), "utf8")).toBe('{"weights":{}}\n');
    expect(await exists(join(root, ".env"))).toBe(false);
    expect(await exists(join(root, `../${basename(root)}-outside.json`))).toBe(false);
    expect(await exists(join(root, "Digests/2026/x.json"))).toBe(false);
  });
});
