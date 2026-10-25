import { describe, expect, it } from "vitest";
import {
  DEFAULTS,
  LENGTHS,
  MORE_OPTIONS_TEMPLATE,
  moreOptionsSummary,
  submitLabel,
  topicOptions,
  WINDOWS,
} from "./createForm";

describe("submitLabel", () => {
  it("names the action only; the Length control shows the minutes", () => {
    expect(submitLabel()).toBe("Generate catch up");
  });
});

describe("moreOptionsSummary", () => {
  it("names the window and the tone, each with its noun, with the one separator", () => {
    expect(moreOptionsSummary("Readout", "Neutral")).toBe("Readout · Neutral tone");
    expect(moreOptionsSummary("Discussion", "Energetic")).toBe("Discussion · Energetic tone");
  });

  it("leaves a placeholder for the page script in the template, and nothing else", () => {
    expect(MORE_OPTIONS_TEMPLATE.match(/\{\w+\}/g)).toEqual(["{format}", "{tone}"]);
  });
});

describe("the options", () => {
  it("offer the defaults among them", () => {
    expect(LENGTHS.some((option) => option.value === DEFAULTS.length)).toBe(true);
    expect(WINDOWS.some((option) => option.value === DEFAULTS.window)).toBe(true);
  });
});

describe("topicOptions", () => {
  const CHIP_VALUES = new Set(["design", "ai", "technology", "software"]);
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

  it("is one alphabetical list, never Top picks or Trending", () => {
    const options = topicOptions([], general);
    expect(options.map((option) => option.label)).toEqual([
      "AI",
      "Business",
      "Culture",
      "Design",
      "Science",
      "Software Engineering",
      "Sports",
      "Technology",
      "World",
    ]);
    expect(options.map((option) => option.value)).not.toContain("top");
    expect(options.flatMap((option) => option.ids)).not.toContain("trending");
  });

  it("expands Design to two sections and Technology to the owner's tech section", () => {
    const ids = Object.fromEntries(topicOptions([], general).map((o) => [o.value, o.ids]));
    expect(ids.design).toEqual(["design", "ui-craft"]);
    expect(ids.ai).toEqual(["ai"]);
    expect(ids.technology).toEqual(["tech"]);
    expect(ids.software).toEqual(["software"]);
    expect(ids.world).toEqual(["world"]);
    expect(ids.sports).toEqual(["sports"]);
  });

  it("starts with the owner's four ticked: Design, AI, Technology and Software Engineering", () => {
    const ticked = topicOptions([], [...general, mine()])
      .filter((option) => option.ticked)
      .map((option) => option.label);
    expect(ticked).toEqual(["AI", "Design", "Software Engineering", "Technology"]);
  });

  it("titles of the owner's topics follow the file; Design, AI and Technology are fixed", () => {
    const options = topicOptions([{ id: "ai", title: "Artificial" }], [mine()]);
    expect(options.map((option) => option.label)).toEqual([
      "AI",
      "Audio interfaces",
      "Design",
      "Software Engineering",
      "Technology",
    ]);
  });

  it("names the general chips as the file does and leaves out one that is off", () => {
    const options = topicOptions(
      [],
      [news("world", "Global"), news("business", "Business", false), news("sports", "Sport")],
    );
    expect(options.map((option) => option.label)).toEqual([
      "AI",
      "Design",
      "Global",
      "Software Engineering",
      "Sport",
      "Technology",
    ]);
    expect(options.find((option) => option.value === "world")?.ids).toEqual(["world"]);
  });

  it("adds the owner's enabled custom topics, unticked", () => {
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
    expect(
      options.filter(
        (option) => !CHIP_VALUES.has(option.value) && option.ids[0] === "audio_interfaces",
      ),
    ).toEqual([
      {
        value: "audio_interfaces",
        label: "Audio interfaces",
        ids: ["audio_interfaces"],
        ticked: false,
      },
    ]);
    expect(options).toHaveLength(10);
  });

  it("never offers one id twice", () => {
    const all = topicOptions([], [...general, mine()]).flatMap((option) => option.ids);
    expect(new Set(all).size).toBe(all.length);
  });
});
