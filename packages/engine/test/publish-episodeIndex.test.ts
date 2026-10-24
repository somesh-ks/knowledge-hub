import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  EPISODE_INDEX_KEY,
  type Episode,
  EpisodeIndex,
  episodeRelPath,
  serializeEpisodeFile,
} from "@dispatch/core";
import { afterEach, beforeEach, expect, it } from "vitest";
import { publishEpisodeIndex } from "../src/publish/episodeIndex.js";
import {
  type FakeBlob,
  makeFakeBlob,
  makeTempRoot,
  must,
  type TempRoot,
  writeRepoFile,
} from "./audio-fixtures.js";

/**
 * The episode index (D173) is what lets the site show an episode before a build. The bugs it
 * prevents: one unreadable file taking the whole index down, so no new episode shows; and a removed
 * or replaced episode lingering in the index, so the Library offers a page that is gone.
 */

const NOW = new Date("2026-10-24T12:00:00Z");

function episode(id: string, generatedAt: string): Episode {
  return {
    id,
    title: `Episode ${id}`,
    request: {
      topic_ids: ["ai"],
      length_minutes: 5,
      format: "readout",
      window_days: 7,
      tone: "neutral",
    },
    generated_at: generatedAt,
    listen_minutes: 5,
    format: "readout",
    sources: [
      {
        item_id: "0123456789ab",
        url: "https://example.com/a",
        headline: "A headline",
        source: "Example",
      },
    ],
    turns: [{ idx: 0, speaker: "a", text: "Hello." }],
    char_count: 6,
    cover: { template: "spring", palette: "dusk", seed: 1 },
  };
}

let temp: TempRoot;
let blob: FakeBlob;

beforeEach(async () => {
  temp = await makeTempRoot();
  blob = makeFakeBlob();
});
afterEach(async () => {
  await temp.cleanup();
});

async function write(id: string, at: string): Promise<void> {
  await writeRepoFile(temp.root, episodeRelPath(id), serializeEpisodeFile(episode(id, at)));
}

function stored(): EpisodeIndex {
  const body = must(blob.store.get(EPISODE_INDEX_KEY), "the index").body;
  return EpisodeIndex.parse(JSON.parse(new TextDecoder().decode(body)));
}

it("lists every readable episode newest first and skips a broken file instead of failing", async () => {
  await write("ep-20261020-0900", "2026-10-20T09:00:00Z");
  await write("ep-20261023-1800", "2026-10-23T18:00:00Z");
  await writeRepoFile(temp.root, episodeRelPath("ep-20261022-0800"), "not an episode");

  const { skipped } = await publishEpisodeIndex(blob, temp.root, NOW);

  expect(stored().episodes.map((entry) => entry.id)).toEqual([
    "ep-20261023-1800",
    "ep-20261020-0900",
  ]);
  expect(skipped).toEqual([episodeRelPath("ep-20261022-0800")]);
});

it("drops an episode once its file is gone, so a removal or replacement leaves the index", async () => {
  await write("ep-20261020-0900", "2026-10-20T09:00:00Z");
  await write("ep-20261023-1800", "2026-10-23T18:00:00Z");
  await publishEpisodeIndex(blob, temp.root, NOW);

  await rm(join(temp.root, episodeRelPath("ep-20261020-0900")));
  await publishEpisodeIndex(blob, temp.root, NOW);

  expect(stored().episodes.map((entry) => entry.id)).toEqual(["ep-20261023-1800"]);
});
