import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALLOWLISTS,
  allowlistAdditions,
  boundaryProblems,
  checkDesignSystemPr,
  listEntries,
  SYSTEM_NAMES,
  SYSTEM_PATHS,
  systemSources,
} from "./designSystemGate.mjs";

// Without the gate a feature branch edits a shared component on the side, and the owner finds out
// when a screen changes. The gate holds the two halves of one rule: system changes carry the label,
// and a labelled pull request carries nothing else.
describe("design-system gate", () => {
  // A repo-wide move (npm to pnpm, D382) edits every app's manifest and deploy config, the guide's
  // too; that is not a system change, and the label would then reject the rest of the move.
  it("lets a feature pull request through when it leaves the system alone", () => {
    const files = [
      "apps/web/src/pages/library.astro",
      "packages/engine/src/run.ts",
      "apps/design/package.json",
      "apps/design/vercel.json",
      "apps/design/ignore-build.sh",
    ];
    expect(checkDesignSystemPr({ files, labels: ["review"] })).toEqual([]);
  });

  it("asks an unlabelled pull request that edits a component or a shared stylesheet to move it", () => {
    for (const file of [
      "packages/design-system/src/Button.astro",
      "packages/design-system/styles/buttons.css",
      "packages/design-system/tokens/tokens.json",
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
      "packages/design-system/src/Button.astro",
      "packages/design-system/styles/buttons.css",
      "apps/web/src/components/Banner.astro",
      "apps/design/src/pages/buttons.astro",
      "docs/decisions/design-system.md",
      "AGENTS.md",
      // A file moved into the system moves its paths in the build filters and the blast-radius map.
      "apps/admin/ignore-build.sh",
      "scripts/blastRadius.mjs",
    ];
    expect(
      checkDesignSystemPr({
        files,
        labels: ["design-system", "review"],
        namesSystem: () => true,
      }),
    ).toEqual([]);
  });

  // Mid-move, a branch that edits the old paths lands a change the move then loses or must redo.
  it("freezes the system while the move to its package is open, and lets the move itself through", () => {
    const files = ["packages/design-system/src/Button.astro", "pnpm-lock.yaml"];
    const frozen = checkDesignSystemPr({
      files: files.slice(0, 1),
      labels: ["design-system"],
      frozenBy: [760],
    });
    expect(frozen).toHaveLength(1);
    expect(frozen[0]).toContain("#760");
    expect(checkDesignSystemPr({ files: ["docs/x.md"], labels: [], frozenBy: [760] })).toEqual([]);
    expect(checkDesignSystemPr({ files, labels: ["ds-migration"], frozenBy: [] })).toEqual([]);
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
    // A file that imports from the system draws it, so a module moved into design-system/ (D382)
    // makes each importer a call site.
    expect(SYSTEM_NAMES.test('import { warmWhenIdle } from "../design-system/idle";')).toBe(true);
  });

  it("names each file a labelled pull request carries that is not design-system work", () => {
    const files = [
      "packages/design-system/src/Button.astro",
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

  // A system file that imports app code (lib/, scripts/, components/) cannot leave for its own
  // repository; ten such back-imports had grown unseen before this check.
  it("fails a design-system file that imports app code, and lets it import its own files", () => {
    const at = "packages/design-system/src/Sheet.astro";
    const text = [
      'import Header from "./SheetHeader.astro";',
      'import { MENU_BACK } from "./menu";',
      'import "../styles/sheet.css";',
      'import art from "../flags/se.svg";',
      'import { escapeHtml } from "../../../apps/web/src/lib/sheetHead";',
      'import { warm } from "../../../apps/web/src/scripts/idle";',
      'const view = () => import("../../../apps/web/src/components/SheetHeader.astro");',
      'import type { HTMLAttributes } from "astro/types";',
      'import { SUPPORTED_TIMEZONES } from "@singularity/core/time";',
      'import { loadDigest } from "@singularity/engine";',
    ].join("\n");
    expect(boundaryProblems([{ file: at, text }])).toEqual([
      `${at}: ../../../apps/web/src/lib/sheetHead`,
      `${at}: ../../../apps/web/src/scripts/idle`,
      `${at}: ../../../apps/web/src/components/SheetHeader.astro`,
      `${at}: @singularity/core/time`,
      `${at}: @singularity/engine`,
    ]);
    // The generators go with the package too (step 6 filters it into its own repository).
    const script = "packages/design-system/scripts/buildTokens.ts";
    const imports =
      'import { readFileSync } from "node:fs";\nimport { a } from "../../../scripts/colorMath.js";';
    expect(boundaryProblems([{ file: script, text: imports }])).toEqual([
      `${script}: ../../../scripts/colorMath.js`,
    ]);
  });

  // The workflow runs only on its path filter, so a system path missing there escaped the label
  // rule and the freeze (flag.css, glow.css and the fonts were missing on 2026-11-07).
  it("runs the workflow on every system path", () => {
    const workflow = readFileSync(
      join(import.meta.dirname, "../.github/workflows/design-system.yml"),
      "utf8",
    );
    const filter = [...workflow.matchAll(/^ {6}- (\S+)$/gm)].map(([, glob]) => glob);
    expect(filter).toEqual(
      SYSTEM_PATHS.map((path) =>
        path.endsWith("/") || path.endsWith("/flags") ? `${path}**` : path,
      ),
    );
  });

  it("finds the system's files, so the boundary check cannot pass over an empty folder", () => {
    const root = join(import.meta.dirname, "..");
    const sources = systemSources(root);
    expect(sources.length).toBeGreaterThan(20);
    expect(sources.some(({ file }) => file.includes("/scripts/system/"))).toBe(true);
    expect(boundaryProblems(sources)).toEqual([]);
  });
});
