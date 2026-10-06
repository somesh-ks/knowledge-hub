import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeDigestFile } from "@dispatch/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeDigest } from "../testing/digestFactory";
import { FIXTURE_AUDIO_PATH, loadSite, rewriteFixtureAudioUrl, usesFixtures } from "./site";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dispatch-site-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeFileIn(path: string, text: string): Promise<void> {
  const file = join(root, path);
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, text);
}

async function addDigest(base: string, id: string): Promise<void> {
  const [year, month] = id.split("-");
  await writeFileIn(`${base}/${year}/${month}/${id}.md`, serializeDigestFile(makeDigest({ id })));
}

describe("usesFixtures", () => {
  it("is on only for DISPATCH_FIXTURES=1", () => {
    expect(usesFixtures({ DISPATCH_FIXTURES: "1" })).toBe(true);
    expect(usesFixtures({ DISPATCH_FIXTURES: "true" })).toBe(false);
    expect(usesFixtures({})).toBe(false);
  });
});

describe("rewriteFixtureAudioUrl", () => {
  it("points the fixture host at the same-origin file", () => {
    expect(rewriteFixtureAudioUrl("https://fixtures.dispatch.invalid/audio.wav")).toBe(
      FIXTURE_AUDIO_PATH,
    );
  });

  it("leaves real audio URLs alone", () => {
    const url = "https://abc.public.blob.vercel-storage.com/audio/2026-10-07.mp3";
    expect(rewriteFixtureAudioUrl(url)).toBe(url);
    expect(rewriteFixtureAudioUrl("not a url")).toBe("not a url");
  });
});

describe("loadSite", () => {
  it("tolerates zero digests and shows no invented content", async () => {
    const site = await loadSite({ root, env: {}, warn: () => {} });
    expect(site.entries).toEqual([]);
    expect(site.showNothingBanner).toBe(false);
    expect(site.lastRun.outcome).toBeNull();
  });

  it("reads real digests from Digests/ by default", async () => {
    await addDigest("Digests", "2026-10-05");
    await addDigest("Digests", "2026-10-07");
    const site = await loadSite({ root, env: {}, warn: () => {} });
    expect(site.entries.map((entry) => entry.id)).toEqual(["2026-10-07", "2026-10-05"]);
    expect(site.fixtures).toBe(false);
  });

  it("never reads fixtures unless DISPATCH_FIXTURES=1", async () => {
    await addDigest("apps/web/src/fixtures/digests", "2026-10-07");
    const site = await loadSite({ root, env: {}, warn: () => {} });
    expect(site.entries).toEqual([]);
  });

  it("reads the fixtures, and only the fixtures, when asked", async () => {
    await addDigest("apps/web/src/fixtures/digests", "2026-10-07");
    await addDigest("Digests", "2026-10-05");
    const site = await loadSite({ root, env: { DISPATCH_FIXTURES: "1" }, warn: () => {} });
    expect(site.entries.map((entry) => entry.id)).toEqual(["2026-10-07"]);
    expect(site.fixtures).toBe(true);
  });

  it("shows the nothing-new banner when the newest run found nothing after the last digest", async () => {
    await addDigest("Digests", "2026-10-05");
    await writeFileIn(
      "state/last-run.json",
      JSON.stringify({
        version: 1,
        regular: { at: "2026-10-07T05:30:00.000Z", outcome: "nothing", items: 0 },
      }),
    );
    const site = await loadSite({ root, env: {}, warn: () => {} });
    expect(site.showNothingBanner).toBe(true);
  });

  it("passes warnings about skipped files to the logger", async () => {
    await writeFileIn("Digests/2026/10/broken.md", "no frontmatter");
    const warnings: string[] = [];
    await loadSite({ root, env: {}, warn: (message) => warnings.push(message) });
    expect(warnings).toHaveLength(1);
  });
});
