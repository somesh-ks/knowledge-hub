import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

/**
 * A finished briefing's narration is published twice: the MP3 the voice service made, and the same
 * speech as Opus in MP4 (`.m4a`), mono at 32 kbps (plan 19.1). WebM is not published: WebKit says it
 * can play it and then cannot. The player picks per browser (web/src/player/core/audioSource.ts) and
 * keeps the MP3 as the fallback. Live segments are not transcoded.
 */
export const OPUS_BITRATE_KBPS = 32;

export const OPUS_CONTENT_TYPE = "audio/mp4";

/** The ffmpeg arguments for one MP3 to Opus transcode: mono, speech-tuned, no metadata. */
export function opusTranscodeArgs(input: string, output: string, concat = false): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    // A list file of MP3s joined end to end, for an episode made of turns.
    ...(concat ? ["-f", "concat", "-safe", "0"] : []),
    "-i",
    input,
    "-vn",
    "-map_metadata",
    "-1",
    "-ac",
    "1",
    "-c:a",
    "libopus",
    "-b:a",
    `${OPUS_BITRATE_KBPS}k`,
    "-application",
    "voip",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    output,
  ];
}

export type RunFfmpeg = (args: string[]) => Promise<void>;

const execFileAsync = promisify(execFile);

const runFfmpeg: RunFfmpeg = async (args) => {
  await execFileAsync("ffmpeg", args, { maxBuffer: 1024 * 1024, timeout: 120_000 });
};

/**
 * Transcode MP3 bytes to Opus in MP4 with the ffmpeg on the PATH (preinstalled on the Ubuntu
 * runners). The duration is not read from the result: the record keeps the source's.
 */
export async function transcodeToOpus(
  mp3: Uint8Array,
  run: RunFfmpeg = runFfmpeg,
): Promise<Uint8Array> {
  if (mp3.byteLength === 0) throw new Error("Refusing to transcode empty audio");
  const dir = await mkdtemp(join(tmpdir(), "singularity-opus-"));
  try {
    const input = join(dir, "in.mp3");
    const output = join(dir, "out.m4a");
    await writeFile(input, mp3);
    await run(opusTranscodeArgs(input, output));
    const bytes = await readFile(output);
    if (bytes.byteLength === 0) throw new Error("ffmpeg wrote an empty file");
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** An episode's one Opus file and the length of each turn in it, in playing order. */
export interface EpisodeOpusFile {
  audio: Uint8Array;
  durations_ms: number[];
}

/** The rate a length is measured at: decoded samples, counted, so the count is the length. */
const MEASURE_RATE = 48_000;

/**
 * The length of an audio file as ffmpeg decodes it, which is what the concat joins end to end. Not
 * ffprobe's duration: on ffmpeg 6 it counts an MP3's encoder padding (about 52 ms a turn), which the
 * decoder trims, so the offsets drifted further off the voice with every turn.
 */
function probeMs(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      ["-v", "error", "-i", file, "-f", "s16le", "-ac", "1", "-ar", String(MEASURE_RATE), "-"],
      { stdio: ["ignore", "pipe", "ignore"], timeout: 30_000 },
    );
    let bytes = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const ms = Math.round((bytes / 2 / MEASURE_RATE) * 1000);
      if (code !== 0 || ms <= 0) reject(new Error(`ffmpeg read no length from ${file}`));
      else resolve(ms);
    });
  });
}

/**
 * Transcode several MP3s, played one after another, to ONE Opus in MP4 file (an episode's turns).
 * The turns' lengths come back with it, measured on the files: an MP3's size says its length only
 * to within its encoder padding and tag frames, and the manifest's offsets must be where the turns
 * really start, so the transcript does not drift off the voice.
 */
export async function transcodeSegmentsToOpus(
  mp3s: readonly Uint8Array[],
  run: RunFfmpeg = runFfmpeg,
  probe: (file: string) => Promise<number> = probeMs,
): Promise<EpisodeOpusFile> {
  if (mp3s.length === 0 || mp3s.some((mp3) => mp3.byteLength === 0)) {
    throw new Error("Refusing to transcode empty audio");
  }
  const dir = await mkdtemp(join(tmpdir(), "singularity-opus-"));
  try {
    const names = mp3s.map((_, index) => `in${index}.mp3`);
    await Promise.all(mp3s.map((mp3, index) => writeFile(join(dir, names[index] ?? ""), mp3)));
    const list = join(dir, "list.txt");
    await writeFile(list, names.map((name) => `file '${name}'\n`).join(""));
    const output = join(dir, "out.m4a");
    await run(opusTranscodeArgs(list, output, true));
    const bytes = await readFile(output);
    if (bytes.byteLength === 0) throw new Error("ffmpeg wrote an empty file");
    const durations_ms = await Promise.all(names.map((name) => probe(join(dir, name))));
    return {
      audio: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      durations_ms,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
