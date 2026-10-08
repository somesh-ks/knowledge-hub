import { SECTIONS } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import {
  DEFAULTS,
  estimateText,
  FORMATS,
  LENGTHS,
  MAX_TITLE_CHARS,
  MAX_TOPICS,
  TONES,
  topicOptions,
  WINDOWS,
} from "./createForm";
import { CHARS_PER_MINUTE } from "./episodeFile";

describe("estimateText", () => {
  it("says the minutes and the characters they come to", () => {
    expect(estimateText(5)).toBe("About 5 minutes, roughly 4,800 characters of narration.");
    expect(estimateText(15)).toBe("About 15 minutes, roughly 14,400 characters of narration.");
    expect(estimateText(1)).toBe("About 1 minute, roughly 960 characters of narration.");
  });

  it("uses the pace the episode files are measured at", () => {
    expect(CHARS_PER_MINUTE).toBe(960);
  });
});

describe("the options", () => {
  it("are the ones the server accepts, and the defaults are among them", () => {
    expect(LENGTHS.map((option) => option.value)).toEqual([3, 5, 10, 15]);
    expect(WINDOWS.map((option) => option.value)).toEqual([2, 7, 30]);
    expect(FORMATS.map((option) => option.value)).toEqual(["readout", "discussion", "headlines"]);
    expect(TONES.map((option) => option.value)).toEqual(["neutral", "energetic", "dry"]);
    expect(LENGTHS.some((option) => option.value === DEFAULTS.length)).toBe(true);
    expect(WINDOWS.some((option) => option.value === DEFAULTS.window)).toBe(true);
  });

  it("keep the limits the server enforces", () => {
    expect(MAX_TOPICS).toBe(6);
    expect(MAX_TITLE_CHARS).toBe(80);
  });
});

describe("topicOptions", () => {
  it("offers only the sections that appear, in the order a briefing lists them", () => {
    expect(topicOptions(["research", "top", "top"]).map((option) => option.value)).toEqual([
      "top",
      "research",
    ]);
    expect(topicOptions(["ai"])[0]?.label).toBe("AI models and products");
  });

  it("offers every section when no briefing says which exist", () => {
    expect(topicOptions([]).map((option) => option.value)).toEqual([...SECTIONS]);
  });
});
