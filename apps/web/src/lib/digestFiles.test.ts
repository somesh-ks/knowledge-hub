import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeDigestFile } from "@dispatch/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeDigest, makeTimeline } from "../testing/digestFactory";
import { readDigestFiles } from "./digestFiles";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dispatch-digests-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeDigest(id: string, text?: string): Promise<string> {
  const [year, month] = id.split("-");
  const directory = join(root, year ?? "", month ?? "");
  await mkdir(directory, { recursive: true });
  const file = join(directory, `${id}.md`);
  await writeFile(file, text ?? serializeDigestFile(makeDigest({ id })));
  return file;
}

describe("readDigestFiles", () => {
  it("returns nothing for a directory that does not exist", async () => {
    const result = await readDigestFiles(join(root, "missing"));
    expect(result.sources).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("returns nothing for an empty directory", async () => {
    expect((await readDigestFiles(root)).sources).toEqual([]);
  });

  it("reads digests from nested year and month folders", async () => {
    await writeDigest("2026-10-07");
    await writeDigest("2026-09-30");
    const { sources } = await readDigestFiles(root);
    expect(sources.map((source) => source.digest.id).sort()).toEqual(["2026-09-30", "2026-10-07"]);
    expect(sources.every((source) => source.timeline === null)).toBe(true);
  });

  it("attaches the audio timeline that sits beside a digest", async () => {
    const digest = makeDigest({ id: "2026-10-07" });
    const file = await writeDigest("2026-10-07");
    await writeFile(file.replace(/\.md$/, ".audio.json"), JSON.stringify(makeTimeline(digest)));
    const { sources } = await readDigestFiles(root);
    expect(sources[0]?.timeline?.digest).toBe("2026-10-07");
  });

  it("ignores a timeline that belongs to a different digest", async () => {
    const other = makeDigest({ id: "2026-10-05" });
    const file = await writeDigest("2026-10-07");
    await writeFile(file.replace(/\.md$/, ".audio.json"), JSON.stringify(makeTimeline(other)));
    const { sources } = await readDigestFiles(root);
    expect(sources[0]?.timeline).toBeNull();
  });

  it("skips a malformed digest with a warning and keeps the rest", async () => {
    await writeDigest("2026-10-07");
    const bad = await writeDigest("2026-10-05", "---\nid: not-a-date\n---\n");
    const { sources, warnings } = await readDigestFiles(root);
    expect(sources.map((source) => source.digest.id)).toEqual(["2026-10-07"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(bad);
    expect(warnings[0]).toContain("skipped");
  });

  it("skips a file with no frontmatter, such as a README", async () => {
    await writeDigest("2026-10-07");
    await writeFile(join(root, "README.md"), "# Digests\n");
    const { sources, warnings } = await readDigestFiles(root);
    expect(sources).toHaveLength(1);
    expect(warnings).toHaveLength(1);
  });

  it("ignores a broken timeline file instead of failing the digest", async () => {
    const file = await writeDigest("2026-10-07");
    await writeFile(file.replace(/\.md$/, ".audio.json"), "{ not json");
    const { sources } = await readDigestFiles(root);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.timeline).toBeNull();
  });
});
