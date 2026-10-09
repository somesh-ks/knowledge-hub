import { describe, expect, it } from "vitest";
import type { ConfigOp } from "../types/contracts";
import { buildQueue, failureText, type Pending } from "./managePageSave";
import { idText, keywordList, slugify } from "./topicsEditor";
import { problemText, webAddress } from "./topicsSheet";

describe("slugify", () => {
  it("makes lowercase letters, digits and hyphens", () => {
    expect(slugify("Motion craft", [])).toBe("motion-craft");
    expect(slugify("  CSS & canvas: 3D!  ", [])).toBe("css-canvas-3d");
  });

  it("always yields an id the server accepts", () => {
    for (const name of ["Motion craft", "é", "日本語", "a", "x".repeat(80), "---", "AI/ML 2026"]) {
      expect(slugify(name, [])).toMatch(/^[a-z0-9_-]{2,40}$/);
    }
  });

  it("falls back to topic when nothing usable is left", () => {
    expect(slugify("日本語", [])).toBe("topic");
    expect(slugify("a", [])).toBe("topic");
  });

  it("adds a number when the id is taken, and keeps within 40 characters", () => {
    expect(slugify("Motion craft", ["motion-craft"])).toBe("motion-craft-2");
    expect(slugify("Motion craft", ["motion-craft", "motion-craft-2"])).toBe("motion-craft-3");
    expect(slugify("x".repeat(80), ["x".repeat(36)])).toHaveLength(38);
  });
});

describe("idText", () => {
  it("is empty for a name with no letters or digits, so it can be refused", () => {
    for (const name of ["", "   ", "\u{1F525}", "---", "日本語", "a"]) {
      expect(idText(name).length).toBeLessThan(2);
    }
    expect(idText("AI")).toBe("ai");
  });
});

describe("webAddress", () => {
  it("adds https to a bare site", () => {
    expect(webAddress("example.com")).toBe("https://example.com/");
    expect(webAddress(" blog.example.com/feed.xml ")).toBe("https://blog.example.com/feed.xml");
  });

  it("keeps an address that has its scheme", () => {
    expect(webAddress("http://example.com/rss")).toBe("http://example.com/rss");
    expect(webAddress("https://example.com")).toBe("https://example.com/");
  });

  it("refuses anything that is not a web address", () => {
    for (const bad of ["", "   ", "ftp://example.com", "javascript:alert(1)", "localhost", "a b"]) {
      expect(webAddress(bad), bad).toBeNull();
    }
  });
});

describe("keywordList", () => {
  it("splits on commas, trims, and drops empties and repeats", () => {
    expect(keywordList(" motion, , type ,motion")).toEqual(["motion", "type"]);
    expect(keywordList("")).toEqual([]);
  });

  it("holds no more than a topic can", () => {
    expect(keywordList(Array.from({ length: 50 }, (_, i) => `w${i}`).join(","))).toHaveLength(30);
  });
});

describe("problemText", () => {
  it("says one thing to do for each refusal", () => {
    for (const status of [400, 422, 429, 504, 0]) {
      expect(problemText(status)).toMatch(/\.$/);
      expect(problemText(status).split(". ").length).toBeLessThanOrEqual(2);
    }
  });
});

describe("failureText", () => {
  it("names the refusal and says the changes are kept", () => {
    expect(failureText(401, 0, 3)).toBe("Saving was refused. Your changes are still waiting.");
    expect(failureText(503, 0, 1)).toBe(
      "Saving is not available right now. Your changes are still waiting.",
    );
    expect(failureText(0, 0, 1)).toBe(
      "The site could not be reached. Your changes are still waiting.",
    );
  });

  it("says how many were saved when the queue stopped part of the way", () => {
    expect(failureText(400, 2, 5)).toBe(
      "Saved 2 of 5. That change was not accepted. The rest is still waiting.",
    );
  });

  it("never asks for the passphrase back in a message that is not about it", () => {
    for (const status of [400, 429, 503, 0]) {
      expect(failureText(status, 0, 1)).not.toMatch(/passphrase/i);
    }
  });
});

describe("buildQueue", () => {
  const row = (value?: string) => ({
    closest: () => ({ querySelector: () => (value === undefined ? null : { value }) }),
  });
  const pending = (op: ConfigOp, el: unknown = row()): Pending => ({
    op,
    el: el as HTMLElement,
    now: "",
  });
  const topic = {
    id: "audio",
    name: "Audio",
    description: "Audio.",
    weight: 0.5,
    enabled: true,
    keywords: [],
    section_id: "tech",
  };

  it("sends every slider change in one request, after the other edits", () => {
    const changes = new Map<string, Pending>([
      ["w1", pending({ op: "weights.set", weights: { audio: 1 } })],
      ["e1", pending({ op: "source.set", id: "studio-notes", enabled: false })],
      ["w2", pending({ op: "weights.set", weights: { motion: 0.25 } })],
    ]);
    expect(buildQueue(changes)).toEqual([
      { op: { op: "source.set", id: "studio-notes", enabled: false }, keys: ["e1"] },
      { op: { op: "weights.set", weights: { audio: 1, motion: 0.25 } }, keys: ["w1", "w2"] },
    ]);
  });

  it("sends a new topic and the sources chosen for it as one request, topic first", () => {
    const add: ConfigOp = { op: "source.add", url: "https://a.example/feed", topic_ids: ["audio"] };
    const upsert: ConfigOp = { op: "topic.upsert", topic };
    const changes = new Map<string, Pending>([
      ["new1", { ...pending(upsert), with: [add, { ...add, url: "https://b.example/feed" }] }],
    ]);
    const steps = buildQueue(changes);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.ops?.map((op) => op.op)).toEqual(["topic.upsert", "source.add", "source.add"]);
    expect(steps[0]?.keys).toEqual(["new1"]);
  });

  it("sends removals last, so nothing is edited after it is gone", () => {
    const changes = new Map<string, Pending>([
      ["r", pending({ op: "topic.remove", id: "audio" })],
      ["u", pending({ op: "topic.upsert", topic: { ...topic, enabled: false } })],
      ["w", pending({ op: "weights.set", weights: { audio: 0 } })],
      ["s", pending({ op: "source.remove", id: "old-feed" })],
    ]);
    expect(buildQueue(changes).map((step) => step.op.op)).toEqual([
      "topic.upsert",
      "weights.set",
      "topic.remove",
      "source.remove",
    ]);
  });

  it("gives a topic edit the slider's value now, not the one it had when the page was built", () => {
    const changes = new Map<string, Pending>([
      ["u", pending({ op: "topic.upsert", topic: { ...topic, weight: 0.5 } }, row("0.75"))],
    ]);
    const [step] = buildQueue(changes);
    expect(step?.op).toMatchObject({ op: "topic.upsert", topic: { weight: 0.75 } });
  });

  it("leaves the weight alone when the row has no slider", () => {
    const changes = new Map<string, Pending>([
      ["u", pending({ op: "topic.upsert", topic: { ...topic, weight: 0.5 } }, row())],
    ]);
    expect(buildQueue(changes)[0]?.op).toMatchObject({ topic: { weight: 0.5 } });
  });

  it("is empty when nothing changed", () => {
    expect(buildQueue(new Map())).toEqual([]);
  });
});
