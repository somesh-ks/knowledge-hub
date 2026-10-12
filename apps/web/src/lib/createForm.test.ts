import { describe, expect, it } from "vitest";
import {
  AUDIENCES,
  DEFAULTS,
  LENGTHS,
  MORE_OPTIONS_TEMPLATE,
  moreOptionsSummary,
  submitLabel,
  topicOptions,
  WINDOWS,
} from "./createForm";

describe("submitLabel", () => {
  it("names the action and the length, with a dot between", () => {
    expect(submitLabel(10)).toBe("Generate • 10 mins");
    expect(submitLabel(3)).toBe("Generate • 3 mins");
  });
});

describe("moreOptionsSummary", () => {
  it("names the window and the tone, each with its noun, with the one separator", () => {
    expect(moreOptionsSummary("7 days", "Neutral")).toBe("Last 7 days · Neutral tone");
    expect(moreOptionsSummary("2 days", "Energetic")).toBe("Last 2 days · Energetic tone");
  });

  it("leaves a placeholder for the page script in the template, and nothing else", () => {
    expect(MORE_OPTIONS_TEMPLATE.match(/\{\w+\}/g)).toEqual(["{window}", "{tone}"]);
  });
});

describe("the options", () => {
  it("offer the defaults among them", () => {
    expect(LENGTHS.some((option) => option.value === DEFAULTS.length)).toBe(true);
    expect(WINDOWS.some((option) => option.value === DEFAULTS.window)).toBe(true);
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
  it("are General and Somesh, Somesh by default", () => {
    expect(AUDIENCES.map((audience) => audience.value)).toEqual(["general", "custom"]);
    expect(AUDIENCES.map((audience) => audience.label)).toEqual(["General", "Somesh"]);
    // In a sentence: "For General", "Topics set for Somesh".
    expect(AUDIENCES.map((audience) => audience.phrase)).toEqual(["General", "Somesh"]);
    expect(DEFAULTS.audience).toBe("custom");
  });
});
