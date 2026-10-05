import { describe, expect, it } from "vitest";
import {
  type Digest,
  Digest as DigestSchema,
  daysBetween,
  digestRelPath,
  homeSection,
  itemId,
  longDate,
  parseDigestFile,
  serializeDigestFile,
  stockholmDate,
  weekday,
} from "./index.js";

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
    expect(homeSection("hci_empirical_research", "rss")).toBe("research");
    expect(homeSection("design_engineering_craft", "youtube")).toBe("watch");
    expect(homeSection("venture_capital_and_gossip", "rss")).toBeNull();
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
});
