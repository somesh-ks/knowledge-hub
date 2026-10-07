import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  VOICE_LIMITS,
  weekday,
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

  it("holds the weekly cap plus the tech allowance, with one item to spare", () => {
    const items = (count: number) => Array.from({ length: count }, (_, n) => sampleItem(n));
    const most = VOICE_LIMITS.items.weeklyCap + VOICE_LIMITS.items.techCap;
    expect(most).toBe(23);
    expect(DigestSchema.safeParse({ ...sampleDigest, items: items(24) }).success).toBe(true);
    expect(DigestSchema.safeParse({ ...sampleDigest, items: items(25) }).success).toBe(false);
  });
});

describe("digests committed before the four-beat voice", () => {
  it.each(["2026-10-06", "2026-10-07"])(
    "parses Digests/2026/10/%s.md, which carries a why line on every item",
    (id) => {
      const text = readFileSync(join(REPO_ROOT, digestRelPath(id)), "utf8");
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

describe("voice limits", () => {
  it("describes a four-beat summary and keeps the legacy why limit", () => {
    expect(VOICE_LIMITS).toMatchObject({
      headlineWords: 12,
      summaryWords: 80,
      summarySentences: 4,
      summaryMinWords: 25,
      summaryMinSentences: 2,
      sentenceWords: 28,
      whyWords: 18,
    });
    expect(VOICE_LIMITS.items).toEqual({
      floor: 3,
      target: [8, 12],
      cap: 12,
      weeklyCap: 18,
      techCap: 5,
    });
  });
});
