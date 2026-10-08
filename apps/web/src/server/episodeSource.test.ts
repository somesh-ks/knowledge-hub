import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { EPISODE_ID, parseEpisodeFile } from "../lib/episodeFile";
import { bundledEpisodeIds, bundledEpisodes } from "./episodeSource";

/**
 * The function reads episodes from what the bundler compiled in, not from disk. This compares the
 * two, so a glob that stops matching fails here and not in production. Podcasts/ does not exist
 * until the first episode is committed, and then both sides are simply empty.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const PODCASTS = join(ROOT, "Podcasts");
const onDisk = existsSync(PODCASTS)
  ? readdirSync(PODCASTS, { recursive: true, encoding: "utf8" })
      .filter((name) => name.endsWith(".md"))
      .map((name) => basename(name, ".md"))
      .sort()
      .reverse()
  : [];

describe("bundledEpisodes", () => {
  it("holds every episode file in the repository, newest first", () => {
    expect(bundledEpisodeIds()).toEqual(onDisk);
  });

  it("returns each episode as the text of its file", async () => {
    for (const id of onDisk.slice(0, 5)) {
      expect(EPISODE_ID.test(id), id).toBe(true);
      const text = await bundledEpisodes.readEpisode(id);
      expect(typeof text, id).toBe("string");
      expect(parseEpisodeFile(text ?? "").id).toBe(id);
    }
  });

  it("answers null for an episode this build does not have", async () => {
    expect(await bundledEpisodes.readEpisode("ep-19990101-0000")).toBeNull();
    expect(await bundledEpisodes.readEpisode("../Digests/2026-10-07")).toBeNull();
  });
});
