import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AutoAdjust,
  categoryIsOff,
  compareNewestFirst,
  type Digest,
  Digest as DigestSchema,
  daysBetween,
  digestRelPath,
  gmtOffset,
  homeSection,
  itemId,
  longDate,
  Preferences,
  parseDigestFile,
  SUPPORTED_TIMEZONES,
  seedTopicsFile,
  serializeDigestFile,
  stockholmDate,
  stockholmHour,
  Topic,
  VOICE_LIMITS,
  weekday,
  zonedDate,
  zonedHour,
  zoneLabel,
} from "./index.js";

/** Repository root, found from this file so the test never depends on the working directory. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const sampleItem = (n: number): Digest["items"][number] => ({
  id: itemId(`https://example.com/${n}`),
  section: "ui-craft",
  category: "design_engineering_craft",
  source_type: "rss",
  headline: `Headline ${n}`,
  url: `https://example.com/${n}`,
  source: "Example",
  summary: "A short summary.",
  why: "Copy the pattern.",
  score: 0.8,
});

const sampleDigest: Digest = {
  id: "2026-10-07",
  date: "2026-10-07",
  kind: "regular",
  verified: true,
  generated_at: "2026-10-07T05:13:00.000Z",
  window: { from: "2026-10-05T05:13:00.000Z", to: "2026-10-07T05:13:00.000Z" },
  read_minutes: 2,
  listen_minutes: 4,
  audio: null,
  cover: { template: "spring", palette: "dusk", seed: 4117 },
  items: [sampleItem(1), sampleItem(2), sampleItem(3)],
};

describe("ids", () => {
  it("makes a stable 12 hex character item id", () => {
    expect(itemId("https://example.com/a")).toMatch(/^[0-9a-f]{12}$/);
    expect(itemId("https://example.com/a")).toBe(itemId("https://example.com/a"));
    expect(itemId("https://example.com/a")).not.toBe(itemId("https://example.com/b"));
  });
});

describe("time", () => {
  it("uses the Stockholm calendar date", () => {
    expect(stockholmDate(new Date("2026-10-07T22:30:00Z"))).toBe("2026-10-08");
    expect(stockholmDate(new Date("2026-10-07T05:13:00Z"))).toBe("2026-10-07");
  });
  it("uses the Stockholm hour on both sides of the October clock change", () => {
    expect(stockholmHour(new Date("2026-10-11T05:30:00Z"))).toBe(7);
    expect(stockholmHour(new Date("2026-10-26T06:30:00Z"))).toBe(7);
    expect(stockholmHour(new Date("2026-10-07T22:30:00Z"))).toBe(0);
  });
  // A schedule counted in Stockholm while the owner picked another zone ran at the wrong hour (D89).
  it.each([
    ["Stockholm, the default", "2026-10-07T22:30:00Z", undefined, "2026-10-08", 0],
    ["New York in summer time", "2026-10-12T11:00:00Z", "America/New_York", "2026-10-12", 7],
    [
      "New York after the November change",
      "2026-11-02T12:00:00Z",
      "America/New_York",
      "2026-11-02",
      7,
    ],
    [
      "New York after the March change",
      "2026-03-09T11:00:00Z",
      "America/New_York",
      "2026-03-09",
      7,
    ],
    [
      "New York still on the day before",
      "2026-10-12T02:00:00Z",
      "America/New_York",
      "2026-10-11",
      22,
    ],
    ["India's half hour", "2026-10-12T02:00:00Z", "Asia/Kolkata", "2026-10-12", 7],
    ["Auckland across the date line", "2026-10-11T20:00:00Z", "Pacific/Auckland", "2026-10-12", 9],
    ["UTC", "2026-10-11T23:30:00Z", "UTC", "2026-10-11", 23],
  ])("counts the date and hour in %s", (_name, at, zone, date, hour) => {
    expect(zonedDate(new Date(at), zone)).toBe(date);
    expect(zonedHour(new Date(at), zone)).toBe(hour);
  });
  // The picker names a zone by its offset, and the offset moves with daylight saving.
  it.each([
    ["Stockholm in winter", "Europe/Stockholm", "2026-01-15T12:00:00Z", "GMT+1"],
    ["Stockholm in summer", "Europe/Stockholm", "2026-07-15T12:00:00Z", "GMT+2"],
    ["New York in summer", "America/New_York", "2026-07-15T12:00:00Z", "GMT-4"],
    ["India's half hour", "Asia/Kolkata", "2026-07-15T12:00:00Z", "GMT+5:30"],
    ["UTC", "UTC", "2026-07-15T12:00:00Z", "GMT+0"],
    ["a name Intl does not know", "Mars/Olympus", "2026-07-15T12:00:00Z", "GMT+0"],
  ])("names the offset of %s", (_name, zone, at, offset) => {
    expect(gmtOffset(zone, new Date(at))).toBe(offset);
  });
  it("reads a zone as its place and offset, and lists every zone once", () => {
    expect(
      zoneLabel(
        { value: "Europe/Stockholm", label: "Stockholm" },
        new Date("2026-07-15T12:00:00Z"),
      ),
    ).toBe("Stockholm (GMT+2)");
    const values = SUPPORTED_TIMEZONES.map((option) => option.value);
    expect(new Set(values).size).toBe(values.length);
  });
  it("counts calendar days and weekdays", () => {
    expect(daysBetween("2026-10-05", "2026-10-07")).toBe(2);
    expect(weekday("2026-10-11")).toBe(0);
    expect(longDate("2026-10-07")).toBe("Wednesday 7 October");
  });
});

describe("paths and sections", () => {
  it("builds digest paths", () => {
    expect(digestRelPath("2026-10-07-weekly")).toBe("Digests/2026/10/2026-10-07-weekly.md");
  });
  it("maps categories to sections", () => {
    expect(homeSection("hci_empirical_research", "rss")).toBe("design");
    expect(homeSection("developer_tool_launches", "rss")).toBe("software");
    expect(homeSection("software_engineering_depth", "rss")).toBe("software");
    // A video goes where its category goes; "watch" no longer receives stories.
    expect(homeSection("design_engineering_craft", "youtube")).toBe("ui-craft");
    // Off, not a missing home, keeps a category out of a briefing.
    expect(homeSection("venture_capital_and_gossip", "rss")).toBe("ai");
  });
  // D194: topic weight is gone, but a stored preferences row, topics file or profile still carries it.
  it("ignores the weights, weight and auto-adjust topics an older document still carries", () => {
    const fixture = "packages/engine/test/fixtures/config/preferences.json";
    const saved = JSON.parse(readFileSync(join(REPO_ROOT, fixture), "utf8"));
    expect(saved.weights).toBeDefined();
    expect(Preferences.parse(saved)).not.toHaveProperty("weights");
    const topic = seedTopicsFile().topics[0];
    expect(Topic.parse({ ...topic, weight: 0.9 })).not.toHaveProperty("weight");
    const adjust = AutoAdjust.parse({ topics: { design: { value: 0.1, at: "2026-10-01" } } });
    expect(adjust).toEqual({ sources: {} });
  });
  // A topic the owner muted at weight 0 stays off once weight is gone.
  it("keeps legacy muted topics off, including built-in categories that ignore enabled", () => {
    for (const origin of ["builtin", "custom", "app", "general"] as const) {
      const topic = { ...seedTopicsFile().topics[0], origin, never_publish: false };
      for (const weight of [0, 0.05]) {
        const muted = Topic.parse({ ...topic, enabled: true, weight });
        expect(muted.enabled).toBe(false);
        expect(muted.never_publish).toBe(origin === "builtin");
        expect(muted).not.toHaveProperty("weight");
        expect(categoryIsOff({ ...seedTopicsFile(), topics: [muted] }, muted.id)).toBe(
          origin === "builtin",
        );
      }
      for (const enabled of [true, false]) {
        expect(Topic.parse({ ...topic, enabled, weight: 0.051 })).toMatchObject({
          enabled,
          never_publish: false,
        });
      }
      expect(Topic.parse({ ...topic, never_publish: true, weight: 0 }).never_publish).toBe(true);
    }
  });
});

describe("digest file", () => {
  it("round-trips through serialize and parse", () => {
    const text = serializeDigestFile(sampleDigest);
    expect(text.startsWith("---\n")).toBe(true);
    expect(text).toContain("# Wednesday 7 October");
    expect(parseDigestFile(text)).toEqual(DigestSchema.parse(sampleDigest));
  });
  it("rejects a digest with fewer than three items", () => {
    expect(() => serializeDigestFile({ ...sampleDigest, items: [sampleItem(1)] })).toThrow();
  });

  it("round-trips an item without a why line and prints no Why line for it", () => {
    const { why: _why, ...story } = sampleItem(1);
    const digest: Digest = { ...sampleDigest, items: [story, sampleItem(2), sampleItem(3)] };
    const text = serializeDigestFile(digest);
    expect(text.match(/^Why: /gm)).toHaveLength(2);
    expect(text.match(/^ {4}why: /gm)).toHaveLength(2);
    const parsed = parseDigestFile(text);
    expect(parsed).toEqual(DigestSchema.parse(digest));
    expect(parsed.items[0]).not.toHaveProperty("why");
  });

  it("round-trips a spoken version, keeps it out of the generated body, and parses digests without one", () => {
    const spoken = "Google has a new Pixel, and the headline feature is the screen.";
    const withSpoken: Digest = {
      ...sampleDigest,
      items: [{ ...sampleItem(1), spoken }, sampleItem(2), sampleItem(3)],
    };
    const text = serializeDigestFile(withSpoken);
    expect(text.match(/^ {4}spoken: /gm)).toHaveLength(1);
    const parsed = parseDigestFile(text);
    expect(parsed).toEqual(DigestSchema.parse(withSpoken));
    expect(parsed.items[0]?.spoken).toBe(spoken);
    expect(parsed.items[1]).not.toHaveProperty("spoken");
    // The body is what GitHub shows; the telling is for the narrator alone.
    const body = text.slice(text.indexOf("\n---\n", 4));
    expect(body).not.toContain(spoken);
    expect(
      DigestSchema.safeParse({
        ...sampleDigest,
        items: [{ ...sampleItem(1), spoken: "" }, sampleItem(2), sampleItem(3)],
      }).success,
    ).toBe(false);
  });

  it("holds the weekly cap plus the allowances of Tech and custom sections, up to a hard maximum", () => {
    const items = (count: number) => Array.from({ length: count }, (_, n) => sampleItem(n));
    expect(VOICE_LIMITS.items.weeklyCap + VOICE_LIMITS.items.techCap).toBe(23);
    const most = VOICE_LIMITS.items.hardMax;
    expect(most).toBe(48);
    expect(DigestSchema.safeParse({ ...sampleDigest, items: items(most) }).success).toBe(true);
    expect(DigestSchema.safeParse({ ...sampleDigest, items: items(most + 1) }).success).toBe(false);
  });
});

describe("digests committed before the four-beat voice", () => {
  it.each(["2026-10-06", "2026-10-07"])(
    "parses the frozen copy of digest %s, which carries a why line on every item",
    (id) => {
      const text = readFileSync(
        join(REPO_ROOT, "packages/engine/test/fixtures/digests", `${id}.md`),
        "utf8",
      );
      const digest = parseDigestFile(text);
      expect(digest.id).toBe(id);
      expect(digest.items.length).toBeGreaterThanOrEqual(3);
      for (const item of digest.items) {
        expect(item.why, item.id).toEqual(expect.any(String));
        expect((item.why ?? "").length, item.id).toBeGreaterThan(0);
      }
      // Serializing what was parsed keeps every why line, in the frontmatter and in the body.
      const again = serializeDigestFile(digest);
      expect(again.match(/^Why: /gm)).toHaveLength(digest.items.length);
      expect(parseDigestFile(again)).toEqual(digest);
    },
  );
});

// The one order of briefings (the site, `singularity status`, `singularity health`). Ordering by
// generated_at alone took a regenerated older briefing for the newest and faulted site_stale.
describe("compareNewestFirst", () => {
  it("orders by date, then by when a same-day briefing was written", () => {
    const older = { id: "2026-10-05", date: "2026-10-05", generated_at: "2026-10-22T09:00:00Z" };
    const newer = { id: "2026-10-07", date: "2026-10-07", generated_at: "2026-10-07T05:00:00Z" };
    const second = { id: "2026-10-07-2", date: "2026-10-07", generated_at: "2026-10-07T16:00:00Z" };
    expect([older, newer, second].sort(compareNewestFirst).map((each) => each.id)).toEqual([
      "2026-10-07-2",
      "2026-10-07",
      "2026-10-05",
    ]);
  });
});
