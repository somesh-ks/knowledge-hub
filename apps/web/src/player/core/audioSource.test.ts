import { describe, expect, it } from "vitest";
import { audioCandidates, type PlaybackProbe, shouldFallBack } from "./audioSource";

const all = { url: "a.mp3", m4a_url: "a.m4a" };
const only =
  (...types: string[]) =>
  (type: string) =>
    types.some((supported) => type.startsWith(supported)) ? "maybe" : "";

describe("audioCandidates", () => {
  // Without the order, a browser that plays both takes the larger MP3 first, and one that plays
  // neither is handed a file it cannot decode.
  it("tries MP4 Opus first when the browser does not rule it out, then the MP3", () => {
    expect(audioCandidates(all, only("audio/mp4"))).toEqual(["a.m4a", "a.mp3"]);
    expect(audioCandidates(all, only())).toEqual(["a.mp3"]);
    expect(audioCandidates({ url: "a.mp3" }, only("audio/mp4"))).toEqual(["a.mp3"]);
  });
});

describe("shouldFallBack", () => {
  const probe = (over: Partial<PlaybackProbe>): PlaybackProbe => ({
    errored: false,
    playResolved: false,
    sincePlayMs: 0,
    sinceResolveMs: null,
    advancedSec: 0,
    ...over,
  });

  // WebKit answers "probably" for WebM, never resolves play() and reports no duration: the listener
  // would wait on a silent player. Each way a source can fail without a thrown error must move on.
  it("gives up a source that errors, never starts, or starts and never moves", () => {
    expect(shouldFallBack(probe({ errored: true }))).toBe(true);
    expect(shouldFallBack(probe({ sincePlayMs: 3900 }))).toBe(false);
    expect(shouldFallBack(probe({ sincePlayMs: 4000 }))).toBe(true);
    const resolved = { playResolved: true, sincePlayMs: 2100 };
    expect(shouldFallBack(probe({ ...resolved, sinceResolveMs: 1900 }))).toBe(false);
    expect(shouldFallBack(probe({ ...resolved, sinceResolveMs: 2000, advancedSec: 0 }))).toBe(true);
    expect(shouldFallBack(probe({ ...resolved, sinceResolveMs: 2000, advancedSec: 1.9 }))).toBe(
      false,
    );
  });
});
