import type { Preferences } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { applyPatch, PreferencesPatch } from "./patch.js";

const base: Preferences = {
  profile: "test",
  focus: "test",
  weights: {
    design_engineering_craft: 0.95,
    hci_empirical_research: 0.95,
    ui_component_primitives: 0.95,
    ai_ux_interaction_patterns: 0.95,
    css_canvas_motion_techniques: 0.5,
    frontier_model_releases: 0.5,
    developer_tool_launches: 0.5,
    taste_and_design_philosophy: 0.5,
    venture_capital_and_gossip: 0,
    generic_ai_hype_listicles: 0,
    consumer_tech_releases: 0.85,
    software_engineering_depth: 0.5,
  },
  preferred_keywords: ["shader"],
  preferred_authors: [],
  disliked_patterns: [],
  feedback_history: [],
};

const patch = (over: Partial<PreferencesPatch>): PreferencesPatch =>
  PreferencesPatch.parse({ input: "test", ...over });

describe("applyPatch", () => {
  it("moves a weight one whole stop and records history", () => {
    const { next, changes } = applyPatch(
      base,
      patch({
        weight_deltas: { css_canvas_motion_techniques: 0.04, design_engineering_craft: -1 },
      }),
      "2026-10-07",
    );
    expect(next.weights.css_canvas_motion_techniques).toBe(0.7);
    expect(next.weights.design_engineering_craft).toBe(0.85);
    expect(next.feedback_history).toHaveLength(1);
    expect(changes.length).toBeGreaterThan(0);
  });

  it("moves at most three weights per call and says what it left", () => {
    const { next, clamped } = applyPatch(
      base,
      patch({
        weight_deltas: {
          css_canvas_motion_techniques: 1,
          frontier_model_releases: 1,
          developer_tool_launches: 1,
          taste_and_design_philosophy: 1,
        },
      }),
      "2026-10-07",
    );
    expect(next.weights.developer_tool_launches).toBe(0.7);
    expect(next.weights.taste_and_design_philosophy).toBe(0.5);
    expect(clamped.join(" ")).toContain("taste_and_design_philosophy");
  });

  it("stops at Off and at Most", () => {
    const { next, changes } = applyPatch(
      base,
      patch({ weight_deltas: { venture_capital_and_gossip: -1, design_engineering_craft: 1 } }),
      "2026-10-07",
    );
    expect(next.weights.venture_capital_and_gossip).toBe(0);
    expect(next.weights.design_engineering_craft).toBe(0.95);
    expect(changes).toEqual([]);
  });

  it("adds and removes list entries without duplicates", () => {
    const { next } = applyPatch(
      base,
      patch({
        add_keywords: ["WebGL", "shader"],
        remove_keywords: [],
        add_disliked: ["vc funding round"],
      }),
      "2026-10-07",
    );
    expect(next.preferred_keywords).toEqual(["shader", "WebGL"]);
    expect(next.disliked_patterns).toEqual(["vc funding round"]);
  });

  it("does not add history when nothing changed", () => {
    const { next } = applyPatch(base, patch({}), "2026-10-07");
    expect(next.feedback_history).toHaveLength(0);
  });

  it("rejects unknown categories", () => {
    expect(() =>
      PreferencesPatch.parse({ input: "x", weight_deltas: { nonsense: 0.1 } }),
    ).toThrow();
  });
});
