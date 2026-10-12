import { describe, expect, it, vi } from "vitest";
import {
  idText,
  parseSuggestedAdd,
  problemText,
  slugify,
  topicChanged,
  topicProblems,
  webAddress,
} from "../lib/topicText";
import type { ConfigOp } from "../types/contracts";
import { buildQueue, failureText, MAX_OPS, type Pending, pack, settle } from "./managePageSave";

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

describe("topicChanged", () => {
  const saved = { name: "Audio", description: "Players and voice.", keywords: ["audio", "voice"] };
  it("sees a new name, a new line of what counts, or other keywords", () => {
    expect(topicChanged(saved, { ...saved, name: "Audio and voice" })).toBe(true);
    expect(topicChanged(saved, { ...saved, description: "Sound." })).toBe(true);
    expect(topicChanged(saved, { ...saved, keywords: ["voice", "audio"] })).toBe(true);
  });
  it("ignores space around the words", () => {
    expect(
      topicChanged(saved, { ...saved, name: " Audio ", description: "Players and voice. " }),
    ).toBe(false);
  });
});

describe("parseSuggestedAdd", () => {
  const carried = {
    name: "Dezeen",
    feed_url: "https://www.dezeen.com/feed/",
    favicon_url: "https://www.dezeen.com/favicon.ico",
    topic_id: "design",
  };
  const parse = (value: unknown) => parseSuggestedAdd(JSON.stringify(value));

  it("reads what a + button carries: the feed to add, the name, the icon and the topic", () => {
    expect(parse(carried)).toEqual(carried);
  });

  it("keeps no icon that is not https, and files under no topic when none is given", () => {
    expect(parse({ ...carried, favicon_url: "http://www.dezeen.com/favicon.ico" })).toMatchObject({
      favicon_url: null,
    });
    expect(parse({ ...carried, favicon_url: null, topic_id: undefined })).toMatchObject({
      favicon_url: null,
      topic_id: "",
    });
  });

  it("reads nothing else: a suggestion has no score, and one that arrives with it is dropped", () => {
    const found = parse({ ...carried, score: 2.9, score_label: "Good" });
    expect(found).toEqual(carried);
  });

  it("is null for a button with nothing to add, and never throws", () => {
    for (const bad of [
      undefined,
      "",
      "{not json",
      "null",
      "[]",
      JSON.stringify({ ...carried, feed_url: "" }),
      JSON.stringify({ ...carried, feed_url: "javascript:alert(1)" }),
      JSON.stringify({ ...carried, feed_url: 7 }),
      JSON.stringify({ ...carried, name: " " }),
      JSON.stringify({ feed_url: carried.feed_url }),
    ]) {
      expect(parseSuggestedAdd(bad), String(bad)).toBeNull();
    }
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
  it("names the refusal and says the change is not saved yet", () => {
    expect(failureText(401)).toBe("Saving was refused. Not saved yet.");
    expect(failureText(503)).toBe("Saving is not available right now. Not saved yet.");
    expect(failureText(0)).toBe("The site could not be reached. Not saved yet.");
    expect(failureText(400)).toBe("That change was not accepted. Not saved yet.");
    // A status with no reason of its own is a failure, not an unreachable site.
    expect(failureText(500)).toBe("Saving failed.");
    expect(failureText(501)).toBe("Saving failed.");
  });

  it("never asks for the passphrase back in a message that is not about it", () => {
    for (const status of [400, 429, 503, 0]) {
      expect(failureText(status)).not.toMatch(/passphrase/i);
    }
  });
});

describe("pack", () => {
  const control = (): HTMLElement =>
    ({ matches: () => false, dataset: {} }) as unknown as HTMLElement;
  const edit = (id: string): ConfigOp => ({ op: "source.set", id, enabled: false });

  it("sends every pending edit in one request when the server takes them all", () => {
    const changes = new Map<string, Pending>([
      ["a", { op: edit("a"), el: control(), now: "false" }],
      ["b", { op: edit("b"), el: control(), now: "false" }],
    ]);
    const batches = pack(buildQueue(changes), changes);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.ops.map((op) => (op as { id: string }).id)).toEqual(["a", "b"]);
    expect(batches[0]?.sent.map(([key]) => key)).toEqual(["a", "b"]);
  });

  it("starts a new request at the server's limit, and never splits a topic from its sources", () => {
    const changes = new Map<string, Pending>(
      Array.from({ length: MAX_OPS - 1 }, (_, n): [string, Pending] => [
        `e${n}`,
        { op: edit(`e${n}`), el: control(), now: "false" },
      ]),
    );
    const add: ConfigOp = { op: "source.add", url: "https://a.example/feed" };
    changes.set("new1", {
      op: {
        op: "topic.upsert",
        topic: {
          id: "audio",
          name: "Audio",
          description: "Audio.",
          weight: 0.5,
          enabled: true,
          keywords: [],
          section_id: "audio",
        },
      },
      with: [add],
      el: { matches: () => false, dataset: {}, closest: () => null } as unknown as HTMLElement,
      now: "",
    });
    const batches = pack(buildQueue(changes), changes);
    expect(batches.map((batch) => batch.ops.length)).toEqual([MAX_OPS - 1, 2]);
    expect(batches[1]?.ops.map((op) => op.op)).toEqual(["topic.upsert", "source.add"]);
  });
});

describe("settle", () => {
  const control = (): HTMLElement =>
    ({ matches: () => false, dataset: {} as Record<string, string> }) as unknown as HTMLElement;

  it("makes the sent value a control's new starting point and clears its change", () => {
    const el = control();
    const sent: Pending = { op: { op: "source.set", id: "a", enabled: false }, el, now: "false" };
    const changes = new Map([["a", sent]]);
    settle({ ops: [sent.op], sent: [["a", sent]] }, changes);
    expect(el.dataset.was).toBe("false");
    expect(changes.size).toBe(0);
  });

  it("makes a pressed remove button's state its starting point, so it is not sent again", () => {
    const row = { setAttribute: () => undefined };
    const el = {
      matches: (selector: string) => selector === "[data-remove]",
      closest: () => row,
      dataset: {} as Record<string, string>,
    } as unknown as HTMLElement;
    const sent: Pending = { op: { op: "source.set", id: "a", enabled: false }, el, now: "true" };
    const changes = new Map([["a", sent]]);
    settle({ ops: [sent.op], sent: [["a", sent]] }, changes);
    expect(el.dataset.was).toBe("true");
    expect(changes.size).toBe(0);
  });

  it("leaves a removed topic's page for the Topics list once the removal is saved", () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { assign });
    const topic = { setAttribute: () => undefined };
    const el = {
      matches: (selector: string) => selector === "[data-remove]",
      closest: (selector: string) => (selector === "li" ? null : topic),
      dataset: {} as Record<string, string>,
    } as unknown as HTMLElement;
    const sent: Pending = { op: { op: "topic.remove", id: "knit" }, el, now: "true" };
    settle({ ops: [sent.op], sent: [["a", sent]] }, new Map([["a", sent]]));
    expect(assign).toHaveBeenCalledWith("/settings/topics");
    vi.unstubAllGlobals();
  });

  it("keeps a change made while the request was on its way, for the next one", () => {
    const el = control();
    const sent: Pending = { op: { op: "source.set", id: "a", enabled: false }, el, now: "false" };
    const newer: Pending = { op: { op: "source.set", id: "a", enabled: true }, el, now: "true" };
    const changes = new Map([["a", newer]]);
    settle({ ops: [sent.op], sent: [["a", sent]] }, changes);
    expect(el.dataset.was).toBe("false");
    expect(changes.get("a")).toBe(newer);
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

describe("topicProblems", () => {
  const taken = ["Design", "World"];
  it("refuses a name a topic already has, whatever its case", () => {
    expect(topicProblems({ name: "design", description: "x" }, taken).name).toBe(
      "You already have a topic called Design.",
    );
    expect(topicProblems({ name: " WORLD ", description: "x" }, taken).name).toBe(
      "You already have a topic called World.",
    );
  });
  it("takes a new name", () => {
    expect(topicProblems({ name: "Typography", description: "x" }, taken)).toEqual({
      name: "",
      description: "",
    });
  });
});
