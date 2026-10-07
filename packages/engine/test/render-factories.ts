import type { Category, CoverSpec, Digest, DigestKind, Item } from "@dispatch/core";
import { type BuildDigestInput, buildDigest } from "../src/render/buildDigest.js";
import { createIdAllocator } from "../src/render/digestId.js";
import { assignSections } from "../src/score/selectItems.js";
import type { SelectedItem } from "../src/score/types.js";
import type { WrittenItem } from "../src/write/types.js";
import { makeItem } from "./score-factories.js";

export const NOW = new Date("2026-10-07T05:13:00Z");
export const WINDOW = { from: "2026-10-05T05:13:00Z", to: "2026-10-07T05:13:00Z" };

export const COVER: CoverSpec = { template: "spring", palette: "dusk", seed: 4117 };

const CATEGORY_CYCLE: Category[] = [
  "design_engineering_craft",
  "frontier_model_releases",
  "hci_empirical_research",
  "developer_tool_launches",
  "css_canvas_motion_techniques",
  "ai_ux_interaction_patterns",
];

export interface Fixture {
  items: Item[];
  selected: SelectedItem[];
  written: WrittenItem[];
}

/** A summary in the four-beat voice: three sentences, 35 words, no sentence over 28. */
export function fixtureSummary(i: number): string {
  return `Springlet ${i} swaps the rest target without resetting velocity. Interrupted drawers keep their speed, and the change is about 120 lines of plain JavaScript. A fixed timestep keeps the motion the same on slow phones.`;
}

/** The kind of summary a digest carried before the four-beat voice, paired with a why line. */
export const LEGACY_SUMMARY =
  "Springlet swaps the rest target without resetting velocity. Interrupted drawers keep their speed.";
export const LEGACY_WHY = "Copy the retargeting pattern for drawers and toasts";

/** `count` items that pass every check: distinct urls, valid voice, scores falling from 0.95. */
export function makeFixture(count = 8): Fixture {
  const items: Item[] = [];
  const written: WrittenItem[] = [];
  const candidates: Array<{
    item: Item;
    category: Category;
    home: SelectedItem["home"];
    score: number;
  }> = [];
  for (let i = 0; i < count; i++) {
    const category = CATEGORY_CYCLE[i % CATEGORY_CYCLE.length] as Category;
    const item = makeItem({
      url: `https://example.com/fixture-${i}`,
      source_id: `source-${i % 3}`,
      author: i % 2 === 0 ? `Author ${i}` : undefined,
      published_at: i % 3 === 0 ? `2026-10-0${(i % 5) + 1}T08:00:00Z` : undefined,
    });
    items.push(item);
    const home = (
      {
        design_engineering_craft: "ui-craft",
        css_canvas_motion_techniques: "ui-craft",
        frontier_model_releases: "ai",
        ai_ux_interaction_patterns: "ai",
        hci_empirical_research: "research",
        developer_tool_launches: "launches",
      } as Record<string, SelectedItem["home"]>
    )[category] as SelectedItem["home"];
    candidates.push({ item, category, home, score: Math.round((0.95 - i * 0.03) * 1000) / 1000 });
    written.push({
      id: item.id,
      headline: `Springlet ${i} retargets springs mid-flight`,
      summary: fixtureSummary(i),
    });
  }
  return { items, selected: assignSections(candidates), written };
}

export function buildFixtureDigest(
  count = 8,
  overrides: Partial<BuildDigestInput> = {},
  kind: DigestKind = "regular",
): { digest: Digest; fixture: Fixture } {
  const fixture = makeFixture(count);
  const digest = buildDigest({
    selected: fixture.selected,
    written: fixture.written,
    window: WINDOW,
    kind,
    now: NOW,
    coverPicker: () => COVER,
    allocateId: createIdAllocator(new Set()),
    audio: null,
    ...overrides,
  });
  return { digest, fixture };
}
