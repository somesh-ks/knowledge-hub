import type { Preferences } from "@singularity/core";
import { describe, expect, it } from "vitest";
import { applyPatch, PreferencesPatch } from "./patch.js";

const base: Preferences = {
  profile: "test",
  focus: "test",
  preferred_keywords: ["shader"],
  preferred_authors: [],
  disliked_patterns: [],
  feedback_history: [],
};

const patch = (over: Partial<PreferencesPatch>): PreferencesPatch =>
  PreferencesPatch.parse({ input: "test", ...over });

describe("applyPatch", () => {
  it("records history for a change", () => {
    const { next, changes } = applyPatch(base, patch({ add_keywords: ["WebGL"] }), "2026-10-07");
    expect(next.feedback_history).toHaveLength(1);
    expect(changes.length).toBeGreaterThan(0);
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
});
