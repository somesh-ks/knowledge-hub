import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALLOWLISTS,
  allowlistAdditions,
  checkDesignSystemPr,
  listEntries,
} from "./designSystemGate.mjs";

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
    expect(
      checkDesignSystemPr({
        files,
        labels: ["design-system", "review"],
        namesSystem: () => true,
      }),
    ).toEqual([]);
  });

  it("holds a labelled pull request to app files that name the system, and to its own records", () => {
    const names = new Set(["apps/web/src/components/Banner.astro"]);
    const files = [
      "apps/web/src/components/Banner.astro",
      "apps/web/src/server/health.ts",
      "docs/specs/engine.md",
      "docs/decisions/design-system.md",
    ];
    const problems = checkDesignSystemPr({
      files,
      labels: ["design-system"],
      namesSystem: (file) => names.has(file),
    });
    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).toContain("apps/web/src/server/health.ts");
    expect(problems.join("\n")).toContain("docs/specs/engine.md");
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

  // Without it any pull request names its own hand-made button bespoke, or its page's override of a
  // component, and the check that would have failed it passes (2026-11-04).
  it("asks for the label when a pull request adds to an allowlist, never when it only shrinks one", () => {
    const lists = ["BESPOKE_CONTROLS", "PAGE_OVERRIDES"];
    const file = (bespoke: string[], overrides: string[]) =>
      [
        "const BESPOKE_CONTROLS: [name: string, reason: string][] = [",
        ...bespoke,
        "];",
        "// A list it does not guard.",
        'const OTHER = ["kept-out"];',
        "const PAGE_OVERRIDES: string[] = [",
        ...overrides,
        "];",
      ].join("\n");
    const before = file(
      [
        '  ["create-fab", "the floating create button"],',
        '  [\n    "queue-fold",\n    "the queue\'s whole-row button: a row, not a control face",\n  ],',
        '  ["speed-btn", "the speed trigger"],',
      ],
      [
        '  "create.css: .create-view .field-input.create-title",',
        "  'menu.css: .menu-item[data-x=\"a\"]',",
      ],
    );
    const shrunk = file(
      [
        "  // Reworded, one gone.",
        '  ["create-fab", "the extended floating create button"],',
        '  [\n    "queue-fold",\n    "the queue\'s whole-row button: a row, not a control face",\n  ],',
      ],
      ["  'menu.css: .menu-item[data-x=\"a\"]',"],
    );
    expect(allowlistAdditions(before, shrunk, lists)).toEqual([]);

    const grown = file(
      [
        '  ["create-fab", "the floating create button"],',
        '  ["try-again", "the fallback card\'s retry"],',
        '  ["speed-btn", "the speed trigger"],',
      ],
      [
        '  "create.css: .create-view .field-input.create-title",',
        '  "create.css: .create-view .field-input.create-title",',
        "  'menu.css: .menu-item[data-x=\"a\"]',",
      ],
    );
    const added = allowlistAdditions(before, grown, lists);
    expect(added).toEqual([
      "BESPOKE_CONTROLS: try-again",
      "PAGE_OVERRIDES: create.css: .create-view .field-input.create-title",
    ]);
    const files = ["apps/web/src/styles/styles.test.ts"];
    const unlabelled = checkDesignSystemPr({ files, labels: [], added });
    expect(unlabelled).toHaveLength(1);
    expect(unlabelled[0]).toContain("try-again");
    const labelled = { files, labels: ["design-system"], namesSystem: () => true, added };
    expect(checkDesignSystemPr(labelled)).toEqual([]);
  });

  it("finds every list it guards, so a renamed or moved list cannot stop the guard unseen", () => {
    for (const [file, lists] of Object.entries(ALLOWLISTS)) {
      const text = readFileSync(join(import.meta.dirname, "..", file), "utf8");
      for (const list of lists) {
        expect(listEntries(text, list)?.length, `${file} has no ${list}`).toBeGreaterThan(0);
      }
    }
  });
});
