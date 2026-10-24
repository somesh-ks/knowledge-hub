import type { AudioTimeline, Digest, DigestItem, Section } from "@singularity/core";

/** Builders for tests. Everything is invented and every link points at example.com. */

/** A 12-hex id from a number, so tests can name items without writing hashes. */
export function itemId(seed: number): string {
  return seed.toString(16).padStart(12, "0");
}

export function makeItem(
  seed: number,
  section: Section = "top",
  overrides: Partial<DigestItem> = {},
): DigestItem {
  return {
    id: itemId(seed),
    section,
    category: "design_engineering_craft",
    source_type: "rss",
    headline: `Headline number ${seed}`,
    url: `https://example.com/item-${seed}`,
    source: `Source ${seed}`,
    author: `Author ${seed}`,
    summary: `Summary of item ${seed}. It has two sentences.`,
    why: `Why item ${seed} is worth a look.`,
    score: 0.8,
    ...overrides,
  };
}

export function makeDigest(overrides: Partial<Digest> = {}): Digest {
  const id = overrides.id ?? "2026-10-07";
  const date = overrides.date ?? id.slice(0, 10);
  return {
    id,
    date,
    kind: "regular",
    verified: true,
    generated_at: `${date}T05:20:00.000Z`,
    window: { from: "2026-10-05T05:10:00.000Z", to: `${date}T05:20:00.000Z` },
    read_minutes: 2,
    listen_minutes: 4,
    audio: null,
    cover: { template: "contour", palette: "glacier", seed: 1 },
    items: [makeItem(1, "top"), makeItem(2, "ai"), makeItem(3, "top"), makeItem(4, "research")],
    ...overrides,
  };
}

/** A timeline that gives each item three seconds, in reading order. */
export function makeTimeline(digest: Digest): AudioTimeline {
  const order: Section[] = ["top", "ui-craft", "ai", "research", "launches", "watch"];
  const ordered = order.flatMap((section) =>
    digest.items.filter((item) => item.section === section),
  );
  const items = ordered.map((item, index) => ({
    id: item.id,
    section: item.section,
    start_ms: index * 3000,
    end_ms: (index + 1) * 3000,
  }));
  const sections = order.flatMap((slug) => {
    const first = items.find((item) => item.section === slug);
    return first ? [{ slug, start_ms: first.start_ms }] : [];
  });
  return {
    digest: digest.id,
    voice: "test",
    model: "test",
    timeline: "marks",
    duration_ms: items.length * 3000,
    text_chars: 1000,
    items,
    sections,
  };
}
