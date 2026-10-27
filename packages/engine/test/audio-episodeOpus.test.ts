import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EpisodePlan } from "../src/audio/segmentStore.js";
import { episodeOpusAddress } from "../src/audio/segmentStore.js";
import { transcodeSegmentsToOpus } from "../src/audio/transcode.js";
import { publishEpisodeOpus } from "../src/publish/publishEpisodes.js";
import { makeFakeBlob, makeFakeSpeech, makeLogger } from "./audio-fixtures.js";

/**
 * The episode's one Opus file is the turns' MP3s joined by ffmpeg, and the page lays turns, chapters
 * and the transcript on the manifest's offsets. The bugs this prevents: a join that drifts from the
 * offsets (the transcript then runs ahead of the voice) or that opens a gap or drops audio at a
 * turn boundary. It runs the real concat and transcode on real tone MP3s; without ffmpeg and
 * libopus (a machine that is not the CI runner) it is skipped.
 */

const run = promisify(execFile);
const available =
  spawnSync("ffmpeg", ["-version"]).status === 0 &&
  spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" }).stdout?.includes(
    "libopus",
  ) === true;

const SAMPLE_RATE = 48_000;
const TURNS = [
  { key: "t0", seconds: 2.3, hz: 440 },
  { key: "t1", seconds: 4.1, hz: 660 },
  { key: "t2", seconds: 1.7, hz: 880 },
];

async function tone(dir: string, seconds: number, hz: number): Promise<Uint8Array> {
  const out = join(dir, `${hz}.mp3`);
  // The format the narration comes in: 24 kHz mono, 128 kbit/s constant bitrate.
  await run("ffmpeg", [
    ...["-hide_banner", "-loglevel", "error", "-y"],
    ...["-f", "lavfi", "-i", `sine=frequency=${hz}:sample_rate=24000:duration=${seconds}`],
    ...["-ac", "1", "-c:a", "libmp3lame", "-b:a", "128k", out],
  ]);
  return new Uint8Array(await readFile(out));
}

/** A file's length as decoded: ffprobe's duration counts an MP3's encoder padding on ffmpeg 6. */
async function probeSeconds(file: string): Promise<number> {
  return (await pcm(file)).length / SAMPLE_RATE;
}

async function pcm(file: string): Promise<Int16Array> {
  const { stdout } = (await run(
    "ffmpeg",
    [...["-v", "error", "-i", file, "-f", "s16le", "-ac", "1", "-ar", String(SAMPLE_RATE), "-"]],
    { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
  )) as unknown as { stdout: Buffer };
  return new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 2));
}

/** The longest run of near-silent samples inside [from, to) in milliseconds. */
function longestQuietMs(samples: Int16Array, fromMs: number, toMs: number): number {
  const start = Math.max(0, Math.round((fromMs / 1000) * SAMPLE_RATE));
  const end = Math.min(samples.length, Math.round((toMs / 1000) * SAMPLE_RATE));
  let longest = 0;
  let run_ = 0;
  for (let i = start; i < end; i++) {
    run_ = Math.abs(samples[i] ?? 0) < 300 ? run_ + 1 : 0;
    longest = Math.max(longest, run_);
  }
  return (longest / SAMPLE_RATE) * 1000;
}

/** The ms at which the tone changes frequency, from the zero-crossing rate of 10 ms windows. */
function toneChangeMs(samples: Int16Array, hzBefore: number, hzAfter: number, nearMs: number) {
  const window = SAMPLE_RATE / 100;
  const mid = (hzBefore + hzAfter) / 2;
  const from = Math.max(0, Math.round((nearMs / 1000) * SAMPLE_RATE) - SAMPLE_RATE / 2);
  for (let i = from; i + window < samples.length; i += window / 5) {
    let crossings = 0;
    for (let j = i + 1; j < i + window; j++) {
      if ((samples[j - 1] ?? 0) < 0 !== (samples[j] ?? 0) < 0) crossings++;
    }
    if ((crossings / 2) * 100 > mid) return ((i + window / 2) / SAMPLE_RATE) * 1000;
  }
  return Number.NaN;
}

describe.skipIf(!available)("the episode's one Opus file, with real ffmpeg", () => {
  let dir: string;
  let mp3s: Uint8Array[];
  let m4a: string;
  let manifest: { duration_ms: number; turns: { key: string; start_ms: number; end_ms: number }[] };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "singularity-opus-test-"));
    mp3s = [];
    for (const turn of TURNS) mp3s.push(await tone(dir, turn.seconds, turn.hz));

    const blob = makeFakeBlob();
    const plan = {
      id: "ep-20261019-1930",
      segments: TURNS.map((turn) => ({ key: turn.key, path: `audio/seg/${turn.key}.mp3` })),
    } as unknown as EpisodePlan;
    const made = new Map(plan.segments.map((segment, i) => [segment.path, mp3s[i] as Uint8Array]));
    const outcome = await publishEpisodeOpus(
      {
        root: dir,
        speech: makeFakeSpeech(),
        blob,
        log: makeLogger(),
        now: () => new Date("2026-10-20T06:00:00Z"),
        monthlyChars: 500_000,
        sleep: async () => {},
        transcodeEpisodeOpus: (inputs) => transcodeSegmentsToOpus(inputs),
        fetchAudio: async () => new Uint8Array(),
      },
      plan,
      made,
    );
    expect(outcome).toBe("published");
    const address = episodeOpusAddress(
      plan.id,
      plan.segments.map((segment) => segment.path),
    );
    m4a = join(dir, "episode.m4a");
    await writeFile(m4a, blob.store.get(address.path)?.body ?? new Uint8Array());
    manifest = JSON.parse(new TextDecoder().decode(blob.store.get(address.manifestPath)?.body));
  }, 60_000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("is as long as the turns together, and the manifest's offsets are where the turns really start", async () => {
    const sum = TURNS.reduce((total, turn) => total + turn.seconds, 0) * 1000;
    const real = await Promise.all(TURNS.map((turn) => probeSeconds(join(dir, `${turn.hz}.mp3`))));
    const total = (await probeSeconds(m4a)) * 1000;
    let cursor = 0;
    const errors = manifest.turns.map((turn, index) => {
      const error = Math.abs(turn.start_ms - cursor);
      cursor += (real[index] ?? 0) * 1000;
      return error;
    });
    expect(Math.abs(total - sum)).toBeLessThan(50);
    expect(Math.abs(manifest.duration_ms - sum)).toBeLessThan(50);
    for (const error of errors) expect(error).toBeLessThan(50);
  });

  it("joins the turns with no gap and no overlap", async () => {
    const samples = await pcm(m4a);
    for (const [index, turn] of manifest.turns.slice(1).entries()) {
      const before = TURNS[index];
      const after = TURNS[index + 1];
      // Opus primes its first ~6 ms; anything quiet beyond that around a join is a gap.
      const quiet = longestQuietMs(samples, turn.start_ms - 40, turn.start_ms + 40);
      // The tone changes at the join: a heard overlap or a drop shifts where it changes.
      const changed = toneChangeMs(samples, before?.hz ?? 0, after?.hz ?? 0, turn.start_ms);
      expect(quiet).toBeLessThan(8);
      expect(Math.abs(changed - turn.start_ms)).toBeLessThan(50);
    }
  });
});
