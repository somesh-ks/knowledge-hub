import { describe, expect, it } from "vitest";
import { checkDesignSystemPr } from "./designSystemGate.mjs";

// Without the gate a feature branch edits a shared component on the side, and the owner finds out
// when a screen changes. The gate holds the two halves of one rule: system changes carry the label,
// and a labelled pull request carries nothing else.
describe("design-system gate", () => {
  it("lets a feature pull request through when it leaves the system alone", () => {
    const files = ["apps/web/src/pages/library.astro", "packages/engine/src/run.ts"];
    expect(checkDesignSystemPr({ files, labels: ["review"] })).toEqual([]);
  });

  it("asks an unlabelled pull request that edits a component or a shared stylesheet to move it", () => {
    for (const file of [
      "apps/web/src/design-system/Button.astro",
      "apps/web/src/styles/buttons.css",
      "tokens/tokens.json",
    ]) {
      const problems = checkDesignSystemPr({
        files: [file, "apps/web/src/pages/x.astro"],
        labels: [],
      });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("design-system");
    }
  });

  it("lets a labelled pull request change the system, its call sites, the guide and the docs", () => {
    const files = [
      "apps/web/src/design-system/Button.astro",
      "apps/web/src/styles/buttons.css",
      "apps/web/src/components/Banner.astro",
      "apps/design/src/pages/buttons.astro",
      "docs/decisions/design-system.md",
      "AGENTS.md",
    ];
    expect(checkDesignSystemPr({ files, labels: ["design-system", "review"] })).toEqual([]);
  });

  it("names each file a labelled pull request carries that is not design-system work", () => {
    const files = [
      "apps/web/src/design-system/Button.astro",
      "packages/engine/src/run.ts",
      "config/models.json",
    ];
    const problems = checkDesignSystemPr({ files, labels: ["design-system"] });
    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).toContain("packages/engine/src/run.ts");
    expect(problems.join("\n")).toContain("config/models.json");
  });
});
