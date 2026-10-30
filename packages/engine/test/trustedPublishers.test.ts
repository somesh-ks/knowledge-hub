import { JudgmentsFile } from "@singularity/core";
import { describe, expect, it } from "vitest";
import { judgmentKey } from "../src/judge/cache.js";
import { prefilter } from "../src/prefilter/prefilter.js";
import { scoreItem } from "../src/score/scoreItem.js";
import { DEFAULT_SCORE_THRESHOLD, eligibility } from "../src/score/selectItems.js";
import { replayTrustedPublishers } from "../src/trustedPublishers/replay.js";
import {
  type TrustedPublishersFile,
  trustedPublisherMatcher,
  trustedPublisherQueries,
  withTrustedPublishers,
} from "../src/trustedPublishers/trustedPublishers.js";
import { makeItem, makeSource, NOW } from "./fetch-helpers.js";
import { makeEntry, makeItem as makeScoredItem, plainPreferences } from "./score-factories.js";

const list: TrustedPublishersFile = {
  version: 1,
  enabled: true,
  entries: [{ domain: "openai.com", categories: ["frontier_model_releases"] }],
};
const prefs = plainPreferences();

/** A lab's launch post as Jev scores it: right category, no technique, and flagged as promotion. */
function announcement(
  url: string,
  category: "frontier_model_releases" | "none" = "frontier_model_releases",
) {
  const item = makeScoredItem({ url, canonical_url: url, source_id: "lab" });
  const entry = makeEntry(item, { category, p: 0.95, depth: 0, hype: 0.6, sponsored: 0.3 });
  return { item, scored: scoreItem(entry, prefs, item) };
}

describe("trusted publishers lift", () => {
  it("lets a vetted lab's announcement past the bar that depth and the hype flag sank it under", () => {
    const { scored } = announcement("https://openai.com/index/introducing-a-model");
    expect(eligibility(scored).eligible).toBe(false);
    const lifted = withTrustedPublishers(scored, trustedPublisherMatcher(list));
    expect(lifted.score).toBeGreaterThanOrEqual(DEFAULT_SCORE_THRESHOLD);
    expect(eligibility(lifted).eligible).toBe(true);
  });

  it("changes nothing while the list is off, for another host, or for a category it was not vetted for", () => {
    const off = trustedPublisherMatcher({ ...list, enabled: false });
    const on = trustedPublisherMatcher(list);
    const lab = announcement("https://openai.com/index/x").scored;
    expect(withTrustedPublishers(lab, off)).toBe(lab);
    const other = announcement("https://example.com/news/x").scored;
    expect(withTrustedPublishers(other, on)).toBe(other);
    // The same publisher's off-topic page: Jev placed it nowhere.
    const customer = announcement("https://openai.com/index/customer-story", "none").scored;
    expect(withTrustedPublishers(customer, on)).toBe(customer);
  });

  it("matches a host and its subdomains, never a lookalike", () => {
    const on = trustedPublisherMatcher(list);
    const hit = (url: string) => on({ url }).length > 0;
    expect(hit("https://openai.com/a")).toBe(true);
    expect(hit("https://www.openai.com/a")).toBe(true);
    expect(hit("https://notopenai.com/a")).toBe(false);
    expect(hit("https://openai.com.example.net/a")).toBe(false);
  });
});

describe("trusted publishers queries", () => {
  const topics = [
    {
      id: "frontier_model_releases",
      name: "Model releases",
      description: "Model cards, benchmarks",
      enabled: true,
    },
    { id: "ui_component_primitives", name: "Components", description: "Dialogs", enabled: false },
  ];

  it("asks one query per vetted topic, restricted to its domains", () => {
    const file: TrustedPublishersFile = {
      ...list,
      entries: [
        ...list.entries,
        { domain: "anthropic.com", categories: ["frontier_model_releases"] },
      ],
    };
    expect(trustedPublisherQueries(file, topics)).toEqual([
      {
        id: "trusted-publisher-frontier-model-releases",
        query: "Model releases: Model cards, benchmarks",
        include_domains: ["openai.com", "anthropic.com"],
        category_hint: "frontier_model_releases",
      },
    ]);
  });

  it("asks nothing while the list is off or for a topic that is switched off", () => {
    expect(trustedPublisherQueries({ ...list, enabled: false }, topics)).toEqual([]);
    const off: TrustedPublishersFile = {
      ...list,
      entries: [{ domain: "radix-ui.com", categories: ["ui_component_primitives"] }],
    };
    expect(trustedPublisherQueries(off, topics)).toEqual([]);
  });
});

describe("prefilter with the list", () => {
  it("keeps a vetted page that names none of the owner's keywords", () => {
    const sources = [makeSource({ id: "exa", type: "exa" })];
    const item = makeItem({
      source_id: "exa",
      source_type: "exa",
      url: "https://openai.com/index/introducing",
      title: "Introducing our newest model",
      snippet: "Today we are releasing.",
    });
    const run = (trustedPublishers?: ReturnType<typeof trustedPublisherMatcher>) =>
      prefilter({ items: [item], preferences: prefs, sources, now: NOW, trustedPublishers }).items;
    expect(run()).toHaveLength(0);
    expect(run(trustedPublisherMatcher(list))).toHaveLength(1);
  });
});

describe("trusted publishers replay", () => {
  it("reports the new passers and flags a domain whose items mostly pass", () => {
    const urls = Array.from({ length: 6 }, (_, i) => `https://openai.com/index/post-${i}`);
    const items = urls.map((url) => makeScoredItem({ url, canonical_url: url, source_id: "lab" }));
    // The cache is keyed item:questions_hash:model; an older judgment of the same item must not win.
    const judged = items.map((item) =>
      makeEntry(item, { category: "frontier_model_releases", p: 0.95, depth: 0, hype: 0.6 }),
    );
    const stale = items.map((item) =>
      makeEntry(item, { category: "none", model: "jev-old", judgedAt: "2026-10-01T06:00:00Z" }),
    );
    const entries = Object.fromEntries(
      [...stale, ...judged].map((entry) => [
        judgmentKey(entry.item_id, entry.questions_hash, entry.model),
        entry,
      ]),
    );
    const report = replayTrustedPublishers({
      pools: items,
      judgments: JudgmentsFile.parse({ version: 1, entries }),
      preferences: prefs,
      trustedPublishers: list,
    });
    expect(report.passed_before).toBe(0);
    expect(report.passed_after).toBe(6);
    expect(report.newly_passing).toHaveLength(6);
    expect(report.over_guard).toEqual(["openai.com"]);
  });
});
