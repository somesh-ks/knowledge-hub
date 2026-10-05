import type { Preferences } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { applyPatch, PreferencesPatch } from "./patch.js";

const base: Preferences = {
  profile: "test",
  focus: "test",
  weights: {
    design_engineering_craft: 0.9,
    hci_empirical_research: 0.9,
    ui_component_primitives: 0.9,
    ai_ux_interaction_patterns: 0.9,
    css_canvas_motion_techniques: 0.5,
    frontier_model_releases: 0.5,
    developer_tool_launches: 0.5,
    taste_and_design_philosophy: 0.5,
    venture_capital_and_gossip: 0.1,
    generic_ai_hype_listicles: 0.02,
  },
  preferred_keywords: ["shader"],
  preferred_authors: [],
  disliked_patterns: [],
  feedback_history: [],
};

const patch = (over: Partial<PreferencesPatch>): PreferencesPatch =>
  PreferencesPatch.parse({ input: "test", ...over });

describe("applyPatch", () => {
  it("applies weight deltas and records history", () => {
    const { next, changes } = applyPatch(
      base,
      patch({
        weight_deltas: { css_canvas_motion_techniques: 0.04, venture_capital_and_gossip: -0.05 },
      }),
      "2026-10-07",
    );
    expect(next.weights.css_canvas_motion_techniques).toBe(0.54);
    expect(next.weights.venture_capital_and_gossip).toBe(0.05);
    expect(next.feedback_history).toHaveLength(1);
    expect(changes.length).toBeGreaterThan(0);
  });

  it("clamps a single delta to 0.05", () => {
    const { next, clamped } = applyPatch(
      base,
      patch({ weight_deltas: { css_canvas_motion_techniques: 0.5 } }),
      "2026-10-07",
    );
    expect(next.weights.css_canvas_motion_techniques).toBe(0.55);
    expect(clamped.join(" ")).toContain("limited");
  });

  it("scales deltas when the total exceeds 0.15", () => {
    const deltas = {
      css_canvas_motion_techniques: 0.05,
      frontier_model_releases: 0.05,
      developer_tool_launches: 0.05,
      taste_and_design_philosophy: 0.05,
    };
    const { next, clamped } = applyPatch(base, patch({ weight_deltas: deltas }), "2026-10-07");
    const moved = (
      [
        "css_canvas_motion_techniques",
        "frontier_model_releases",
        "developer_tool_launches",
        "taste_and_design_philosophy",
      ] as const
    )
      .map((k) => Math.abs(next.weights[k] - 0.5))
      .reduce((a, b) => a + b, 0);
    expect(moved).toBeLessThanOrEqual(0.15 + 1e-9);
    expect(clamped.join(" ")).toContain("scaled");
  });

  it("keeps weights inside 0 and 1", () => {
    const { next } = applyPatch(
      { ...base, weights: { ...base.weights, design_engineering_craft: 0.99 } },
      patch({ weight_deltas: { design_engineering_craft: 0.05 } }),
      "2026-10-07",
    );
    expect(next.weights.design_engineering_craft).toBe(1);
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
