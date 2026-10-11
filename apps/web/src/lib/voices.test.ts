import { describe, expect, it } from "vitest";
import { parseVoiceDefaults, parseVoices, voiceLabel } from "./voices";

describe("parseVoices", () => {
  it("reads the API's shape and skips rows without an id or a name", () => {
    expect(
      parseVoices({
        voices: [
          {
            id: "a",
            name: "Ada",
            gender: "female",
            language: "en-US",
            preview_url: "https://x/a.mp3",
          },
          { id: "", name: "No id" },
          { id: "b", name: "Leo", gender: 3 },
          7,
        ],
      }),
    ).toEqual([
      { id: "a", name: "Ada", gender: "female", language: "en-US", preview_url: "https://x/a.mp3" },
      { id: "b", name: "Leo", gender: null, language: null, preview_url: null },
    ]);
  });

  it("refuses anything else", () => {
    for (const bad of [null, "x", {}, { voices: "no" }]) expect(parseVoices(bad)).toBeNull();
  });
});

describe("voiceLabel", () => {
  it("adds the gender when there is one", () => {
    const base = { id: "a", name: "Ada", language: null, preview_url: null };
    expect(voiceLabel({ ...base, gender: "Female" })).toBe("Ada, female");
    expect(voiceLabel({ ...base, gender: null })).toBe("Ada");
  });
});

describe("parseVoiceDefaults", () => {
  it("reads the defaults beside the list, or null without them", () => {
    expect(parseVoiceDefaults({ voices: [], defaults: { voice: "a", voice_b: "b" } })).toEqual({
      voice: "a",
      voice_b: "b",
    });
    expect(parseVoiceDefaults({ voices: [] })).toBeNull();
    expect(parseVoiceDefaults(null)).toBeNull();
  });
});
