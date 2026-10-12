import { describe, expect, it } from "vitest";
import type { ManageSource, ManageTopic } from "./manage";
import {
  byName,
  generalOf,
  OTHER_ID,
  percent,
  sourcesByTopic,
  suggestionWords,
  topicChoicesOf,
  topicLayout,
  topicSummary,
} from "./topicPages";

const topic = (over: Partial<ManageTopic> = {}): ManageTopic => ({
  id: "design",
  name: "Design",
  description: "Design.",
  weight: 0.5,
  step: 2,
  enabled: true,
  keywords: [],
  section_id: "design",
  never_publish: false,
  origin: "builtin",
  ...over,
});

const source = (id: string, topic_id: string | null, score: number | null): ManageSource =>
  ({ id, name: id, host: `${id}.example`, enabled: true, topic_id, score }) as ManageSource;

describe("percent", () => {
  it("shows a stored weight at the slider's step", () => {
    expect(percent(0.5)).toBe("50%");
    expect(percent(0.333)).toBe("35%");
  });
});

describe("sourcesByTopic", () => {
  it("lists each topic's sources best first, and the rest under Other", () => {
    const groups = sourcesByTopic(
      [topic()],
      [
        source("b", "design", 3),
        source("a", "design", 4.5),
        source("c", "gone", null),
        source("d", null, 2),
      ],
    );
    expect(groups.get("design")?.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(groups.get(OTHER_ID)?.map((entry) => entry.id)).toEqual(["d", "c"]);
  });
});

describe("generalOf", () => {
  it("lists the general topics in the app's order, not by name", () => {
    const list = ["sports", "world", "design", "business"].map((id) =>
      topic({ id, name: id, origin: id === "design" ? "builtin" : "general" }),
    );
    expect(generalOf(list).map((item) => item.id)).toEqual(["world", "business", "sports"]);
  });
});

describe("topicSummary", () => {
  it("says a topic's sources, never its weight", () => {
    expect(topicSummary(topic({ origin: "general" }), 2)).toBe("2 sources");
    expect(topicSummary(topic({ origin: "general", enabled: false }), 1)).toBe("Off");
    expect(topicSummary(topic({ weight: 0.95 }), 1)).toBe("1 source");
  });

  it("counts the sources that are read, and says when there are none", () => {
    expect(topicSummary(topic({ origin: "general" }), 3, 2)).toBe("2 of 3 sources on");
    expect(topicSummary(topic({}), 0)).toBe("No sources yet");
    expect(topicSummary(null, 4, 4)).toBe("4 sources");
    expect(topicSummary(null, 1, 0)).toBe("0 of 1 source on");
  });

  it("says Off for a topic that is off, and Never for one that never publishes", () => {
    expect(topicSummary(topic({ enabled: false }), 2)).toBe("Off");
    expect(topicSummary(topic({ never_publish: true }), 0)).toBe("Never in a briefing");
  });
});

describe("byName", () => {
  it("orders topics as a person reads a list, whatever their case", () => {
    const names = [
      "venture capital",
      "Audio interfaces",
      "Design engineering craft",
      "audio books",
    ];
    expect(
      [...names]
        .map((name) => ({ name }))
        .sort(byName)
        .map((t) => t.name),
    ).toEqual(["audio books", "Audio interfaces", "Design engineering craft", "venture capital"]);
  });
});

describe("topicLayout", () => {
  const topics = [
    topic({ id: "craft", name: "Craft", section_id: "ui-craft" }),
    topic({ id: "design", name: "Design", section_id: "design", origin: "app" }),
    topic({ id: "frontier_model_releases", name: "Models", section_id: "ai" }),
    topic({ id: "trending", name: "Trending", section_id: "trending", origin: "app" }),
    topic({ id: "gossip", name: "Gossip", section_id: "top", never_publish: true }),
    topic({ id: "synths", name: "Synths", section_id: "synths", origin: "custom" }),
    topic({ id: "world", name: "World", section_id: "general", origin: "general" }),
  ];
  const sources = [
    source("a", "craft", 2.5),
    source("b", "design", 2.9),
    source("c", "frontier_model_releases", null),
    source("d", "trending", 1),
    source("e", "gossip", 1),
    source("f", null, null),
    source("g", "synths", 2),
    source("h", "world", 2),
  ];

  it("shows three topics of the owner's, their own apart, the general news, and Other for the rest", () => {
    const layout = topicLayout(topics, sources);
    expect(
      layout.groups.map((group) => [group.id, group.home, group.members.map((m) => m.id)]),
    ).toEqual([
      ["design", "design", ["craft", "design"]],
      ["ai", "frontier_model_releases", ["frontier_model_releases"]],
    ]);
    expect(layout.own.map((t) => t.id)).toEqual(["synths"]);
    expect(layout.general.map((t) => t.id)).toEqual(["world"]);
    const ids = (page: string) => layout.sources.get(page)?.map((s) => s.id);
    expect(ids("design")).toEqual(["b", "a"]);
    expect(ids("ai")).toEqual(["c"]);
    expect(ids(OTHER_ID)).toEqual(["d", "e", "f"]);
    expect(topicChoicesOf(layout)).toEqual([
      { id: "frontier_model_releases", name: "AI" },
      { id: "design", name: "Design" },
      { id: "synths", name: "Synths" },
      { id: "world", name: "World" },
    ]);
  });
});

describe("suggestionWords", () => {
  const members = [
    topic({ id: "craft", name: "Design engineering craft", keywords: ["motion"] }),
    topic({ id: "design", name: "Design", description: "Not architecture." }),
  ];
  const group = {
    id: "design",
    name: "Design",
    note: "Product, interface and design engineering.",
    home: "design",
    members,
  };

  it("gives one of the owner's three its name and the names and keywords of the topics it gathers", () => {
    expect(suggestionWords({ group, topic: null })).toEqual({
      id: "design",
      name: "Design",
      keywords: ["Design engineering craft", "motion", "Design"],
    });
  });

  it("gives the owner's own topic its name, description and keywords", () => {
    const own = topic({
      id: "synths",
      name: "Synths",
      description: "Hardware synthesizers.",
      keywords: ["modular"],
      origin: "custom",
    });
    expect(suggestionWords({ group: null, topic: own })).toEqual({
      id: "synths",
      name: "Synths",
      description: "Hardware synthesizers.",
      keywords: ["modular"],
    });
  });

  it("gives a general topic its name alone: its description is a question for the judge", () => {
    const world = topic({
      id: "world",
      name: "World",
      description: "International news and world affairs: conflicts, elections and research.",
      origin: "general",
    });
    expect(suggestionWords({ group: null, topic: world })).toEqual({
      id: "world",
      name: "World",
      keywords: [],
    });
  });

  it("gives Other nothing to go by", () => {
    expect(suggestionWords({ group: null, topic: null })).toBeNull();
  });
});
