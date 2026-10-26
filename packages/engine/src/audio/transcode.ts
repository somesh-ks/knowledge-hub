import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

/**
 * A finished briefing's narration is published three times: the MP3 the voice service made, and the same
 * speech as Opus in WebM and in MP4, mono at 32 kbps (plan 19.1, D-e). The player picks per
 * browser (web/src/player/core/audioSource.ts) and keeps the MP3 as the fallback. Live segments are not transcoded.
 */
export const OPUS_BITRATE_KBPS = 32;

/**
 * The two containers Opus ships in: WebM (Chrome, Edge, Firefox, Android) and MP4 (`.m4a`, which
 * iOS Safari plays where it may not play WebM).
 */
export type OpusContainer = "webm" | "m4a";
export const OPUS_CONTAINERS: readonly OpusContainer[] = ["webm", "m4a"];
export const OPUS_CONTENT_TYPES: Record<OpusContainer, string> = {
  webm: "audio/webm",
  m4a: "audio/mp4",
};

/** The ffmpeg arguments for one MP3 to Opus transcode: mono, speech-tuned, no metadata. */
export function opusTranscodeArgs(
  input: string,
  output: string,
  container: OpusContainer = "webm",
): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
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
    ...(container === "m4a" ? ["-movflags", "+faststart", "-f", "mp4"] : ["-f", "webm"]),
    output,
  ];
}

export type RunFfmpeg = (args: string[]) => Promise<void>;

const execFileAsync = promisify(execFile);

const runFfmpeg: RunFfmpeg = async (args) => {
  await execFileAsync("ffmpeg", args, { maxBuffer: 1024 * 1024 });
};

/**
 * Transcode MP3 bytes to Opus in WebM or MP4 with the ffmpeg on the PATH (preinstalled on the Ubuntu
 * runners). The duration is not read from the result: the record keeps the source's.
 */
export async function transcodeToOpus(
  mp3: Uint8Array,
  container: OpusContainer = "webm",
  run: RunFfmpeg = runFfmpeg,
): Promise<Uint8Array> {
  if (mp3.byteLength === 0) throw new Error("Refusing to transcode empty audio");
  const dir = await mkdtemp(join(tmpdir(), "singularity-opus-"));
  try {
    const input = join(dir, "in.mp3");
    const output = join(dir, `out.${container}`);
    await writeFile(input, mp3);
    await run(opusTranscodeArgs(input, output, container));
    const bytes = await readFile(output);
    if (bytes.byteLength === 0) throw new Error("ffmpeg wrote an empty file");
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
