import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { loadUsage } from "../src/audio/budget.js";
import {
  episodeOpusAddress,
  planEpisodeNarration,
  segmentMarksPath,
} from "../src/audio/segmentStore.js";
import { DEFAULT_OUTPUT_FORMAT, durationFromMp3Bytes } from "../src/audio/speechify.js";
import type { PublishAudioDeps } from "../src/publish/publishAudio.js";
import { listEpisodeCandidates, publishEpisodeAudio } from "../src/publish/publishEpisodes.js";
import type { FakeBlob, FakeSpeech, TempRoot } from "./audio-fixtures.js";
import {
  makeFakeBlob,
  makeFakeSpeech,
  makeLogger,
  makeTempRoot,
  writeRepoFile,
} from "./audio-fixtures.js";

/**
 * `publish` narrates a new episode ahead of time into the files the site plays from. The bugs it
 * prevents: an old episode re-listed every run, a stored turn paid for twice, and a turn stored
 * under a name the site never asks for (the site's side of that is narrateEpisode.test.ts).
 */

const NOW = new Date("2026-10-20T06:00:00Z");
const ENV = { SPEECHIFY_VOICE_ID: "geffen_32" };

function episodeFile(id: string): string {
  const front = stringify({
    id,
    title: "The week",
    generated_at: "2026-10-19T17:30:00.000Z",
    format: "discussion",
    request: { topic_ids: ["ai"], length_minutes: 5, format: "discussion" },
    turns: [
      { idx: 0, speaker: "a", text: "Welcome back.  " },
      { idx: 1, speaker: "b", text: "Two stories today." },
      { idx: 2, speaker: "a", text: "" },
    ],
  });
  return `---\n${front}---\n\nThe script.\n`;
}

const relPath = (id: string): string => `Podcasts/${id.slice(3, 7)}/${id.slice(7, 9)}/${id}.md`;

let temp: TempRoot;
let blob: FakeBlob;
let speech: FakeSpeech;
let deps: PublishAudioDeps;

beforeEach(async () => {
  temp = await makeTempRoot();
  blob = makeFakeBlob();
  speech = makeFakeSpeech();
  deps = {
    root: temp.root,
    speech,
    blob,
    log: makeLogger(),
    now: () => NOW,
    monthlyChars: 500_000,
    sleep: async () => {},
  };
});
afterEach(async () => {
  await temp.cleanup();
});

describe("episode pre-narration", () => {
  it("looks only at recent episodes, and only at the turns the store lacks", async () => {
    for (const id of ["ep-20261019-1930", "ep-20261017-0800", "ep-20261001-0900"]) {
      await writeRepoFile(temp.root, relPath(id), episodeFile(id));
    }
    expect(await listEpisodeCandidates(temp.root, NOW)).toEqual([
      "ep-20261019-1930",
      "ep-20261017-0800",
    ]);
    expect(await listEpisodeCandidates(temp.root, NOW, "ep-20261001-0900")).toEqual([
      "ep-20261001-0900",
    ]);

    // One turn already stored (made on Play): only the other is narrated.
    const plan = planEpisodeNarration(episodeFile("ep-20261019-1930"), ENV);
    blob.seed(plan.segments[0]?.path ?? "", NOW);
    const result = await publishEpisodeAudio(deps, ENV, ["ep-20261019-1930"]);

    expect(result.outcomes[0]?.status).toBe("published");
    expect(speech.calls.marks.map((call) => [call.text, call.voiceId])).toEqual([
      ["Two stories today.", "dominic_32"],
    ]);
    const second = plan.segments[1]?.path ?? "";
    expect(blob.store.has(second)).toBe(true);
    expect(blob.store.has(segmentMarksPath(second))).toBe(true);
    expect((await loadUsage(temp.root, NOW)).speechify.characters).toBe(
      "Two stories today.".length,
    );

    // Complete now: a second run spends nothing.
    const again = await publishEpisodeAudio(deps, ENV, ["ep-20261019-1930"]);
    expect(again.outcomes[0]?.status).toBe("skipped");
    expect(again.changedPaths).toEqual([]);
    expect(speech.calls.marks).toHaveLength(1);
  });

  it("refuses an episode the month's allowance cannot cover, and spends nothing", async () => {
    await writeRepoFile(temp.root, relPath("ep-20261019-1930"), episodeFile("ep-20261019-1930"));
    const result = await publishEpisodeAudio({ ...deps, monthlyChars: 10 }, ENV, [
      "ep-20261019-1930",
    ]);
    expect(result.outcomes[0]?.status).toBe("refused");
    expect(speech.calls.marks).toHaveLength(0);
    expect(blob.puts).toEqual([]);
  });

  describe("as one Opus file", () => {
    const id = "ep-20261019-1930";
    let joined: number[][];
    let withOpus: PublishAudioDeps;

    beforeEach(async () => {
      joined = [];
      await writeRepoFile(temp.root, relPath(id), episodeFile(id));
      withOpus = {
        ...deps,
        async transcodeEpisodeOpus(mp3s) {
          joined.push(mp3s.map((mp3) => mp3.byteLength));
          return new Uint8Array([9, 9]);
        },
        async fetchAudio(url) {
          const pathname = url.split(".vercel-storage.com/")[1] ?? "";
          return blob.store.get(pathname)?.body ?? new Uint8Array();
        },
      };
    });

    it("lays the turns end to end in the manifest, at the lengths the site reads from their sizes", async () => {
      const plan = planEpisodeNarration(episodeFile(id), ENV);
      blob.seed(plan.segments[0]?.path ?? "", NOW);
      await publishEpisodeAudio(withOpus, ENV, [id]);

      const { path, manifestPath } = episodeOpusAddress(
        id,
        plan.segments.map((s) => s.path),
      );
      const manifest = JSON.parse(new TextDecoder().decode(blob.store.get(manifestPath)?.body)) as {
        duration_ms: number;
        turns: { key: string; start_ms: number; end_ms: number }[];
      };
      const lengths = plan.segments.map((segment) =>
        durationFromMp3Bytes(
          blob.store.get(segment.path)?.body.byteLength ?? 0,
          DEFAULT_OUTPUT_FORMAT,
        ),
      );
      expect(manifest.turns.map((turn) => turn.key)).toEqual(plan.segments.map((s) => s.key));
      expect(manifest.turns.map((turn) => turn.end_ms - turn.start_ms)).toEqual(lengths);
      expect(manifest.turns.map((turn) => turn.start_ms)).toEqual(
        lengths.map((_, index) => lengths.slice(0, index).reduce((a, b) => a + b, 0)),
      );
      expect(manifest.duration_ms).toBe(lengths.reduce((a, b) => a + b, 0));
      // The file is joined in playing order, the stored turn read back and the new one kept in memory.
      expect(joined).toHaveLength(1);
      expect(joined[0]).toHaveLength(plan.segments.length);
      // The manifest comes last: it is what says the file is whole.
      expect(blob.puts.indexOf(path)).toBeLessThan(blob.puts.indexOf(manifestPath));
    });

    it("gives an episode that was complete before Opus its file once, and not again", async () => {
      await publishEpisodeAudio(deps, ENV, [id]);
      expect([...blob.store.keys()].some((key) => key.includes("/episode."))).toBe(false);
      await publishEpisodeAudio(withOpus, ENV, [id]);
      expect([...blob.store.keys()].filter((key) => key.includes("/episode."))).toHaveLength(2);
      await publishEpisodeAudio(withOpus, ENV, [id]);
      expect(joined).toHaveLength(1);
    });

    it("leaves the turns alone when the transcode fails", async () => {
      const result = await publishEpisodeAudio(
        {
          ...withOpus,
          async transcodeEpisodeOpus() {
            throw new Error("ffmpeg missing");
          },
        },
        ENV,
        [id],
      );
      expect(result.outcomes[0]?.status).toBe("published");
      expect([...blob.store.keys()].some((key) => key.includes("/episode."))).toBe(false);
    });
  });
});
