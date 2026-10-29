import { describe, expect, it } from "vitest";
import {
  describeMediaError,
  describePlayRejection,
  MEDIA_ERR_SRC_NOT_SUPPORTED,
} from "./audioErrors";

describe("audio error copy", () => {
  it("names an episode as an episode, and points to its transcript", () => {
    expect(describeMediaError(MEDIA_ERR_SRC_NOT_SUPPORTED, true, "episode")?.message).toBe(
      "Audio is not available for this episode.",
    );
    expect(describeMediaError(MEDIA_ERR_SRC_NOT_SUPPORTED, true)?.message).toBe(
      "Audio is not available for this podcast.",
    );
  });

  it("says press, which fits a mouse and a finger", () => {
    const blocked = Object.assign(new Error("no"), { name: "NotAllowedError" });
    expect(describePlayRejection(blocked, true)?.message).toBe(
      "Playback was blocked by the browser. Press play to start.",
    );
  });

  it("carries the noun through a rejected play", () => {
    const unsupported = Object.assign(new Error("no"), { name: "NotSupportedError" });
    expect(describePlayRejection(unsupported, true, "episode")?.message).toContain("this episode");
  });
});
