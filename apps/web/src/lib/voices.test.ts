import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FLAG_REGIONS,
  flagSymbolId,
  parseVoiceDefaults,
  parseVoices,
  voiceFlag,
  voiceKeywords,
  voiceLabel,
} from "./voices";

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

  it("stays plain text whatever the accent: the flag is drawn, never typed", () => {
    const base = { id: "a", name: "Ada", gender: "Female", preview_url: null };
    expect(voiceLabel({ ...base, language: "en-GB" })).toBe("Ada, female");
  });
});

describe("voiceKeywords", () => {
  // The picker's search must find a voice by its accent as a person says it, not by its code.
  it("names the accent in words beside its locale, and nothing for an unknown one", () => {
    const voice = { id: "a", name: "Archie", gender: "male", language: "en-GB", preview_url: null };
    expect(voiceKeywords(voice)).toBe("British English en-GB");
    expect(voiceKeywords({ ...voice, language: null })).toBe("");
  });
});

describe("voiceFlag", () => {
  it("reads a locale's region, and nothing from a locale without one", () => {
    expect(voiceFlag("en-US")).toBe("US");
    expect(voiceFlag("en_au")).toBe("AU");
    for (const language of [null, "", "en", "en-419", "en-Latn"])
      expect(voiceFlag(language)).toBe("");
  });
});

// Windows draws no flag emoji, so the pickers draw SVG from public/flags.svg; a region listed here
// without a symbol there would show a broken flag with no error.
describe("flag sprite", () => {
  const sprite = readFileSync(new URL("../../public/flags.svg", import.meta.url), "utf8");

  it("has a symbol for every region the pickers draw, and the symbol id for a region", () => {
    for (const region of FLAG_REGIONS)
      expect(sprite).toContain(`<symbol id="flag-${region.toLowerCase()}" `);
    expect(sprite.match(/<symbol id="flag-[a-z]{2}" /g)?.length).toBe(FLAG_REGIONS.size);
    expect(flagSymbolId("GB")).toBe("flag-gb");
  });

  it("falls back to no symbol, so a letter badge is drawn, for a region without a flag", () => {
    expect(flagSymbolId("SA")).toBeNull();
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
