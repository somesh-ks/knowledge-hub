import { type Digest, resolveTopics, TopicsFile } from "@singularity/core";
import { describe, expect, it } from "vitest";
import { validateDigest } from "../src/validate/validateDigest.js";
import { buildFixtureDigest } from "./render-factories.js";
import { realPreferences } from "./score-factories.js";
import { testLinter } from "./write-fakes.js";

const linter = testLinter();
const base = resolveTopics(null, realPreferences());
const topics = TopicsFile.parse({
  ...base,
  sections: [...base.sections, { id: "quantum", title: "Quantum computing", order: 7 }],
  topics: [
    ...base.topics,
    {
      id: "quantum_computing",
      name: "Quantum computing",
      description: "Qubits.",
      weight: 0.7,
      enabled: true,
      keywords: [],
      section_id: "quantum",
      never_publish: false,
      origin: "custom",
      depth: "fit_only",
    },
    {
      id: "blocked_topic",
      name: "Blocked",
      description: "Never shown.",
      weight: 0.7,
      enabled: true,
      keywords: [],
      section_id: "quantum",
      never_publish: true,
      origin: "custom",
      depth: "fit_only",
    },
  ],
});

/** A digest whose last `count` items belong to the custom topic and section. */
function withQuantum(count: number): Digest {
  const { digest } = buildFixtureDigest(8);
  const copy = structuredClone(digest);
  for (const item of copy.items.slice(-count)) {
    item.section = "quantum";
    item.category = "quantum_computing";
  }
  copy.section_titles = Object.fromEntries([
    ...[...new Set(copy.items.map((i) => i.section))].map((s) => [s, s]),
  ]);
  return copy;
}

const codes = (digest: Digest, withTopics = true) =>
  validateDigest(digest, { linter, ...(withTopics ? { topics } : {}) }).issues.map(
    (i) => `${i.severity}:${i.code}`,
  );

describe("validateDigest with custom topics", () => {
  it("accepts up to five items in a custom section, outside the main cap", () => {
    expect(codes(withQuantum(5))).toEqual([]);
    expect(codes(withQuantum(2))).toEqual([]);
  });

  it("rejects a sixth item in a custom section", () => {
    const { digest } = buildFixtureDigest(8);
    const big = structuredClone(digest);
    const extra = Array.from({ length: 6 }, (_, n) => ({
      ...structuredClone(big.items[0] as Digest["items"][number]),
      id: `${n}`.padStart(12, "a"),
      url: `https://example.com/extra-${n}`,
      section: "quantum",
      category: "quantum_computing",
    }));
    big.items = [...big.items.slice(0, 5), ...extra];
    const report = validateDigest(big, { linter, topics });
    expect(report.issues.map((i) => i.message)).toContain("6 items in quantum; the limit is 5.");
  });

  it("flags a custom-section story among the Top picks", () => {
    const digest = withQuantum(1);
    const last = digest.items.at(-1);
    if (last) last.section = "top";
    expect(codes(digest)).toContain("error:section_mismatch");
  });

  it("checks a custom topic's section against config/topics.json", () => {
    const digest = withQuantum(1);
    const last = digest.items.at(-1);
    if (last) last.section = "ai";
    expect(codes(digest)).toContain("error:section_mismatch");
    // Without the file the section cannot be known, so an old digest still validates.
    expect(codes(digest, false)).not.toContain("error:section_mismatch");
  });

  it("warns, rather than fails, for a topic that has since been removed", () => {
    const digest = withQuantum(1);
    const last = digest.items.at(-1);
    if (last) last.category = "removed_topic";
    const report = validateDigest(digest, { linter, topics });
    expect(report.ok).toBe(true);
    expect(report.issues.map((i) => `${i.severity}:${i.code}`)).toContain(
      "warning:section_mismatch",
    );
  });

  it("refuses a story from a never-publish topic", () => {
    const digest = withQuantum(1);
    const last = digest.items.at(-1);
    if (last) last.category = "blocked_topic";
    expect(codes(digest)).toContain("error:never_publish");
  });
});
