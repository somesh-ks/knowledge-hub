import type { Item } from "@singularity/core";
import { describe, expect, it } from "vitest";
import {
  type CommunityFile,
  communityShadow,
  communityStrength,
  communityVotes,
  EMPTY_COMMUNITY,
  withCommunity,
} from "../src/community/community.js";
import { scoreItem } from "../src/score/scoreItem.js";
import { DEFAULT_SCORE_THRESHOLD, eligibility } from "../src/score/selectItems.js";
import { makeEntry, makeItem, plainPreferences } from "./score-factories.js";

const on: CommunityFile = { ...EMPTY_COMMUNITY, enabled: true };
const prefs = plainPreferences();

/** A lab's launch post as Jev scores it: no technique, so depth 0 sinks it under the bar. */
function story(
  signals: Item["signals"],
  category:
    | "frontier_model_releases"
    | "none"
    | "consumer_tech_releases" = "frontier_model_releases",
  hype = 0,
) {
  const item = makeItem({ signals });
  const entry = makeEntry(item, { category, p: 0.95, depth: 0, hype });
  return scoreItem(entry, prefs, item);
}

describe("community lift", () => {
  it("airs an announcement the community took up and leaves a quiet one under the bar", () => {
    const quiet = story({ hn_points: 20, hn_comments: 5 });
    const loud = story({ hn_points: 400, hn_comments: 180 });
    expect(eligibility(quiet).eligible).toBe(false);
    expect(eligibility(loud).eligible).toBe(false);
    expect(withCommunity(quiet, on)).toBe(quiet);
    const lifted = withCommunity(loud, on);
    expect(lifted.score).toBeGreaterThanOrEqual(DEFAULT_SCORE_THRESHOLD);
    expect(eligibility(lifted).eligible).toBe(true);
  });

  it("changes nothing while the file is off, for none, consumer tech or a hype-flagged thread", () => {
    const loud = { hn_points: 900, hn_comments: 400 };
    const base = story(loud);
    expect(withCommunity(base, { ...on, enabled: false })).toBe(base);
    const none = story(loud, "none");
    expect(withCommunity(none, on)).toBe(none);
    const tech = story(loud, "consumer_tech_releases");
    expect(withCommunity(tech, on)).toBe(tech);
    // A loud thread rewards hype as readily as substance: the flag still sinks it.
    const hyped = story(loud, "frontier_model_releases", 1);
    expect(eligibility(withCommunity(hyped, on)).eligible).toBe(false);
  });

  it("never scores above real technique, and a deeper story keeps its own score", () => {
    const deep = (() => {
      const item = makeItem({ signals: { hn_points: 900, hn_comments: 400 } });
      return scoreItem(
        makeEntry(item, { category: "frontier_model_releases", p: 0.95, depth: 1 }),
        prefs,
        item,
      );
    })();
    expect(withCommunity(deep, on)).toBe(deep);
    const loud = withCommunity(story({ hn_points: 5000, hn_comments: 2000 }), on);
    expect(loud.score).toBeLessThan(deep.score);
  });

  it("counts votes on every platform and grows slower the more there are", () => {
    expect(communityVotes({ hn_points: 100, hn_comments: 50, reddit_score: 200 })).toBe(350);
    expect(communityVotes({ lobsters_score: 40 })).toBe(200);
    expect(communityStrength({ hn_points: 100 }, on)).toBeNull();
    const mid = communityStrength({ hn_points: 500 }, on) ?? 0;
    const top = communityStrength({ hn_points: 1500 }, on) ?? 0;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(top);
    expect(top).toBe(1);
  });

  it("reads an off file as on only for the shadow log", () => {
    expect(communityShadow({ ...on, enabled: false })?.enabled).toBe(true);
    expect(communityShadow(on)).toBeUndefined();
  });
});
