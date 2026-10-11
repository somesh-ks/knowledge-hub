import { describe, expect, it } from "vitest";
import type { ManageSource, ManageTopic } from "./manage";
import { byName, generalOf, OTHER_ID, percent, sourcesByTopic, topicSummary } from "./topicPages";

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
  it("says a general topic's sources without a weight", () => {
    expect(topicSummary(topic({ origin: "general" }), 2)).toBe("2 sources");
    expect(topicSummary(topic({ origin: "general", enabled: false }), 1)).toBe("Off, 1 source");
  });

  it("says the weight and the sources of a topic that is on", () => {
    expect(topicSummary(topic({ weight: 0.95 }), 1)).toBe("Weight 95%, 1 source");
  });

  it("says Off for a topic that is off, and Never for one that never publishes", () => {
    expect(topicSummary(topic({ enabled: false }), 2)).toBe("Off, 2 sources");
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
