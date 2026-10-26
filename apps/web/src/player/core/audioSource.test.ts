import { describe, expect, it } from "vitest";
import { pickAudioUrl } from "./audioSource";

const all = { url: "a.mp3", webm_url: "a.webm", m4a_url: "a.m4a" };
const only =
  (...types: string[]) =>
  (type: string) =>
    types.some((supported) => type.startsWith(supported)) ? "maybe" : "";

describe("pickAudioUrl", () => {
  // Without the order, a Safari that plays both takes the larger one first, and a browser that
  // plays neither is handed a file it cannot decode.
  it("takes WebM Opus first, then MP4 Opus, then the MP3", () => {
    expect(pickAudioUrl(all, only("audio/webm", "audio/mp4"))).toBe("a.webm");
    expect(pickAudioUrl(all, only("audio/mp4"))).toBe("a.m4a");
    expect(pickAudioUrl(all, only())).toBe("a.mp3");
  });

  it("skips a format the record does not have", () => {
    expect(pickAudioUrl({ url: "a.mp3", m4a_url: "a.m4a" }, only("audio/webm", "audio/mp4"))).toBe(
      "a.m4a",
    );
    expect(pickAudioUrl({ url: "a.mp3" }, only("audio/webm", "audio/mp4"))).toBe("a.mp3");
  });
});
