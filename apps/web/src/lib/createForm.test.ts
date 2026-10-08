import { describe, expect, it } from "vitest";
import {
  AUDIENCES,
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
  const titles = [
    { id: "design", title: "Design" },
    { id: "ui-craft", title: "Design Engineering" },
    { id: "ai", title: "AI Products" },
    { id: "tech", title: "Tech Product Launches" },
    { id: "trending", title: "Trending" },
  ];
  const mine = (over: Record<string, unknown> = {}) => ({
    name: "Audio interfaces",
    section_id: "audio_interfaces",
    origin: "custom" as const,
    enabled: true,
    never_publish: false,
    ...over,
  });

  it("always offers the five topics in the contract's order, never Top picks", () => {
    const options = topicOptions(titles, []);
    expect(options.map((option) => option.label)).toEqual([
      "Design",
      "Design Engineering",
      "AI Products",
      "Tech Product Launches",
      "Trending",
    ]);
    expect(options.map((option) => option.value)).not.toContain("top");
    expect(options.every((option) => !option.custom)).toBe(true);
  });

  it("titles follow the file, and fall back when the file lacks a section", () => {
    expect(topicOptions([{ id: "ai", title: "Artificial" }], [])[2]?.label).toBe("Artificial");
    expect(topicOptions([], [])[0]?.label).toBe("Design");
  });

  it("adds the owner's enabled custom topics after the five, marked custom", () => {
    const options = topicOptions(titles, [
      mine(),
      mine({ name: "Off", section_id: "off", enabled: false }),
      mine({ name: "Builtin", section_id: "x", origin: "builtin" }),
      mine({ name: "Hidden", section_id: "y", never_publish: true }),
      mine({ name: "Shares", section_id: "ai" }),
      mine({ name: "Again", section_id: "audio_interfaces" }),
    ]);
    expect(options.slice(5)).toEqual([
      { value: "audio_interfaces", label: "Audio interfaces", custom: true },
    ]);
  });
});

describe("audiences", () => {
  it("are General and Customized, Customized by default", () => {
    expect(AUDIENCES.map((audience) => audience.value)).toEqual(["general", "custom"]);
    expect(AUDIENCES.map((audience) => audience.label)).toEqual(["General", "Customized"]);
    expect(DEFAULTS.audience).toBe("custom");
  });
});
