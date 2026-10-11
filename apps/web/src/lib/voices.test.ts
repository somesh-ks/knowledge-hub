import { describe, expect, it } from "vitest";
import { parseVoiceDefaults, parseVoices, voiceFlag, voiceLabel } from "./voices";

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

  it("leads with the flag of the voice's accent", () => {
    const base = { id: "a", name: "Ada", gender: "Female", preview_url: null };
    expect(voiceLabel({ ...base, language: "en-GB" })).toBe("\u{1F1EC}\u{1F1E7} Ada, female");
    expect(voiceLabel({ ...base, language: "en" })).toBe("Ada, female");
  });
});

describe("voiceFlag", () => {
  it("turns a locale's region into its flag, and anything else into nothing", () => {
    expect(voiceFlag("en-US")).toBe("\u{1F1FA}\u{1F1F8}");
    expect(voiceFlag("en_au")).toBe("\u{1F1E6}\u{1F1FA}");
    for (const language of [null, "", "en", "en-419", "en-Latn"])
      expect(voiceFlag(language)).toBe("");
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
