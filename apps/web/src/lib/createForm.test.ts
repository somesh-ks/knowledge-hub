import { describe, expect, it } from "vitest";
import {
  AUDIENCES,
  DEFAULTS,
  FORMATS,
  LENGTHS,
  MAX_TITLE_CHARS,
  MORE_OPTIONS_TEMPLATE,
  moreOptionsSummary,
  submitLabel,
  TONES,
  topicOptions,
  WINDOWS,
} from "./createForm";
import { CHARS_PER_MINUTE } from "./episodeFile";

describe("submitLabel", () => {
  it("names the action and the length, with a dot between", () => {
    expect(submitLabel(10)).toBe("Generate • 10 mins");
    expect(submitLabel(3)).toBe("Generate • 3 mins");
  });

  it("uses the pace the episode files are measured at", () => {
    expect(CHARS_PER_MINUTE).toBe(960);
  });
});

describe("moreOptionsSummary", () => {
  it("names the audience, the window and the tone, each with its noun, with the one separator", () => {
    expect(moreOptionsSummary("Somesh", "7 days", "Neutral")).toBe(
      "For Somesh · Last 7 days · Neutral tone",
    );
    expect(moreOptionsSummary("anyone", "2 days", "Dry")).toBe(
      "For anyone · Last 2 days · Dry tone",
    );
  });

  it("leaves a placeholder for the page script in the template, and nothing else", () => {
    expect(MORE_OPTIONS_TEMPLATE.match(/\{\w+\}/g)).toEqual(["{audience}", "{window}", "{tone}"]);
  });
});

describe("the options", () => {
  it("are the ones the server accepts, and the defaults are among them", () => {
    expect(LENGTHS.map((option) => option.value)).toEqual([3, 5, 10, 15]);
    expect(WINDOWS.map((option) => option.value)).toEqual([2, 7, 30]);
    expect(FORMATS.map((option) => option.value)).toEqual(["readout", "discussion"]);
    expect(TONES.map((option) => option.value)).toEqual(["neutral", "energetic", "dry"]);
    expect(LENGTHS.some((option) => option.value === DEFAULTS.length)).toBe(true);
    expect(WINDOWS.some((option) => option.value === DEFAULTS.window)).toBe(true);
  });

  it("name each look-back window by its count of days, so they read as one scale", () => {
    expect(WINDOWS.map((option) => option.label)).toEqual(["2 days", "7 days", "30 days"]);
  });

  it("keep the limits the server enforces", () => {
    expect(MAX_TITLE_CHARS).toBe(80);
  });
});

describe("topicOptions", () => {
  const news = (id: string, name: string, enabled = true) => ({
    id,
    name,
    section_id: "general",
    origin: "general" as const,
    enabled,
    never_publish: false,
  });
  const general = [
    news("world", "World"),
    news("business", "Business"),
    news("science", "Science"),
    news("culture", "Culture"),
    news("sports", "Sports"),
  ];
  const mine = (over: Record<string, unknown> = {}) => ({
    id: "audio_interfaces",
    name: "Audio interfaces",
    section_id: "audio_interfaces",
    origin: "custom" as const,
    enabled: true,
    never_publish: false,
    ...over,
  });

  it("is one list in a fixed order, never Top picks or Trending", () => {
    const options = topicOptions([], general);
    expect(options.map((option) => option.label)).toEqual([
      "Design",
      "AI",
      "Technology",
      "World",
      "Business",
      "Science",
      "Culture",
      "Sports",
    ]);
    expect(options.map((option) => option.value)).not.toContain("top");
    expect(options.flatMap((option) => option.ids)).not.toContain("trending");
  });

  it("expands Design to two sections and Technology to the owner's tech section", () => {
    const ids = Object.fromEntries(topicOptions([], general).map((o) => [o.value, o.ids]));
    expect(ids.design).toEqual(["design", "ui-craft"]);
    expect(ids.ai).toEqual(["ai"]);
    expect(ids.technology).toEqual(["tech"]);
    expect(ids.world).toEqual(["world"]);
    expect(ids.sports).toEqual(["sports"]);
  });

  it("presets: Somesh is Design, AI, Technology; General is the news topics and Technology", () => {
    const ticked = (audience: "custom" | "general") =>
      topicOptions([], [...general, mine()])
        .filter((option) => option.presets.includes(audience))
        .map((option) => option.label);
    expect(ticked("custom")).toEqual(["Design", "AI", "Technology"]);
    expect(ticked("general")).toEqual([
      "Technology",
      "World",
      "Business",
      "Science",
      "Culture",
      "Sports",
    ]);
  });

  it("titles of the owner's topics follow the file; Design, AI and Technology are fixed", () => {
    const options = topicOptions([{ id: "ai", title: "Artificial" }], [mine()]);
    expect(options[1]?.label).toBe("AI");
    expect(options.at(-1)?.label).toBe("Audio interfaces");
  });

  it("names the general chips as the file does and leaves out one that is off", () => {
    const options = topicOptions(
      [],
      [news("world", "Global"), news("business", "Business", false), news("sports", "Sport")],
    );
    expect(options.map((option) => option.label)).toEqual([
      "Design",
      "AI",
      "Technology",
      "Global",
      "Sport",
    ]);
    expect(options.find((option) => option.value === "world")?.ids).toEqual(["world"]);
  });

  it("adds the owner's enabled custom topics after the chips, in no preset", () => {
    const options = topicOptions(
      [],
      [
        ...general,
        mine(),
        mine({ name: "Off", section_id: "off", enabled: false }),
        mine({ name: "Builtin", section_id: "x", origin: "builtin" }),
        mine({ name: "Hidden", section_id: "y", never_publish: true }),
        mine({ name: "Shares", section_id: "ai" }),
        mine({ name: "Folded", section_id: "ui-craft" }),
        mine({ name: "Again", section_id: "audio_interfaces" }),
      ],
    );
    expect(options.slice(8)).toEqual([
      {
        value: "audio_interfaces",
        label: "Audio interfaces",
        ids: ["audio_interfaces"],
        presets: [],
      },
    ]);
  });

  it("never offers one id twice", () => {
    const all = topicOptions([], [...general, mine()]).flatMap((option) => option.ids);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("audiences", () => {
  it("are Anyone and Somesh, Somesh by default", () => {
    expect(AUDIENCES.map((audience) => audience.value)).toEqual(["general", "custom"]);
    expect(AUDIENCES.map((audience) => audience.label)).toEqual(["Anyone", "Somesh"]);
    // In a sentence: "For anyone", "Topics set for Somesh".
    expect(AUDIENCES.map((audience) => audience.phrase)).toEqual(["anyone", "Somesh"]);
    expect(DEFAULTS.audience).toBe("custom");
  });
});
