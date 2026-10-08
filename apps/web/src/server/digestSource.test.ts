import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { AudioTimeline, audioTimelineRelPath, parseDigestFile } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { bundledDigestIds, bundledDigests } from "./digestSource";

/**
 * The function reads digests from what the bundler compiled in, not from disk. This compares the
 * two, so a glob that stops matching (a moved file, a renamed folder) fails here and not in
 * production.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const DIGESTS = join(ROOT, "Digests");
const onDisk = existsSync(DIGESTS)
  ? readdirSync(DIGESTS, { recursive: true, encoding: "utf8" })
      .filter((name) => name.endsWith(".md"))
      .map((name) => basename(name, ".md"))
      .sort()
      .reverse()
  : [];

describe("bundledDigests", () => {
  it("holds every digest file in the repository, newest first", () => {
    expect(bundledDigestIds()).toEqual(onDisk);
  });

  it("returns each digest as the text of its file", async () => {
    for (const id of onDisk.slice(0, 5)) {
      const text = await bundledDigests.readDigest(id);
      expect(typeof text, id).toBe("string");
      expect(parseDigestFile(text ?? "").id).toBe(id);
    }
  });

  it("returns the committed timeline where there is one, and null where there is not", async () => {
    for (const id of onDisk.slice(0, 5)) {
      const timeline = await bundledDigests.readTimeline(id);
      if (existsSync(join(ROOT, audioTimelineRelPath(id)))) {
        expect(AudioTimeline.parse(timeline).digest).toBe(id);
      } else {
        expect(timeline).toBeNull();
      }
    }
  });

  it("answers null for a digest this build does not have", async () => {
    expect(await bundledDigests.readDigest("1999-01-01")).toBeNull();
    expect(await bundledDigests.readTimeline("1999-01-01")).toBeNull();
  });
});
