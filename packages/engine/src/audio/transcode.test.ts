import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { opusTranscodeArgs, transcodeToOpus } from "./transcode.js";

describe("opusTranscodeArgs", () => {
  it("makes mono Opus at 32 kbps, in WebM or MP4 by the container asked for", () => {
    const webm = opusTranscodeArgs("in.mp3", "out.webm", "webm");
    expect(webm).toEqual(expect.arrayContaining(["-ac", "1", "-c:a", "libopus", "-b:a", "32k"]));
    expect(webm.slice(-3)).toEqual(["-f", "webm", "out.webm"]);
    const m4a = opusTranscodeArgs("in.mp3", "out.m4a", "m4a");
    expect(m4a.slice(-3)).toEqual(["-f", "mp4", "out.m4a"]);
    expect(m4a).toContain("+faststart");
  });
});

describe("transcodeToOpus", () => {
  it("hands ffmpeg the input and output paths and returns the file it wrote", async () => {
    const bytes = await transcodeToOpus(new Uint8Array([1, 2, 3]), "m4a", async (args) => {
      const input = args[args.indexOf("-i") + 1] as string;
      expect([...(await readFile(input))]).toEqual([1, 2, 3]);
      await writeFile(args[args.length - 1] as string, new Uint8Array([9, 8]));
    });
    expect([...bytes]).toEqual([9, 8]);
  });

  it("refuses empty audio and an empty result", async () => {
    await expect(transcodeToOpus(new Uint8Array())).rejects.toThrow("empty");
    await expect(
      transcodeToOpus(new Uint8Array([1]), "webm", async (args) => {
        await writeFile(args[args.length - 1] as string, new Uint8Array());
      }),
    ).rejects.toThrow("empty");
  });
});
