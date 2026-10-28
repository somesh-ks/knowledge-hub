#!/usr/bin/env node
// Advisory blast-radius tool: inspects touched files and reports affected consumer surfaces
// and recommended verification commands. Non-blocking (exits 0 by default).
//
// Usage: node scripts/blastRadius.mjs [--all] [--strict]
import { execSync } from "node:child_process";

const SHARED_RULES = [
  {
    pattern: /^(?:tokens\/|apps\/web\/tokens\.json)/,
    risk: "HIGH",
    surface: "Design Tokens (all pages: color, typography, spacing, elevation)",
    checks: ["npm run design-check", "npx playwright test apps/web/e2e/designSystem.spec.ts"],
  },
  {
    pattern: /^apps\/web\/src\/styles\/(?:tokens|primitives|buttons|shell|foundations)\.css$/,
    risk: "HIGH",
    surface: "Shared CSS Primitives (buttons, chips, navigation, sheets across all pages)",
    checks: ["npm run design-check", "npx playwright test apps/web/e2e/designSystem.spec.ts"],
  },
  {
    pattern: /^apps\/web\/src\/layouts\//,
    risk: "HIGH",
    surface: "App Shell Layouts (BaseLayout, head scripts, viewport units)",
    checks: ["npm run check -w @singularity/web", "npm run e2e -w @singularity/web"],
  },
  {
    pattern: /^packages\/core\//,
    risk: "HIGH",
    surface: "Core Schema & Contracts (runtime types, structure, preferences, models)",
    checks: ["npm run typecheck:packages", "npm test"],
  },
  {
    pattern: /^apps\/web\/src\/player\//,
    risk: "MEDIUM",
    surface: "Interactive Audio Player Island (playback, transcript, scrubber, queue)",
    checks: ["npm run e2e:player -w @singularity/web"],
  },
  {
    pattern: /^apps\/web\/src\/(?:sheets|components\/Create)/,
    risk: "MEDIUM",
    surface: "Creation & Drawer Sheets (New episode, prompt adjustments, topics panel)",
    checks: [
      "npm run check -w @singularity/web",
      "npx playwright test apps/web/e2e/create.spec.ts",
    ],
  },
  {
    pattern: /^apps\/web\/src\/(?:pages\/settings|scripts\/structure|lib\/structure)/,
    risk: "MEDIUM",
    surface: "Settings & Preferences (podcast structure, categories, voice, sound)",
    checks: [
      "npx vitest run apps/web/src/lib/structureView.test.ts",
      "npx playwright test apps/web/e2e/settings.spec.ts",
    ],
  },
  {
    pattern: /^apps\/web\/src\/lib\/(?:sheetHead|icons)\.ts$/,
    risk: "MEDIUM",
    surface: "Shared HTML Templates & Glyphs (sheet headers, menu items, action rows)",
    checks: ["npx vitest run apps/web/src/lib/sheetHead.test.ts"],
  },
  {
    pattern: /^docs\//,
    risk: "LOW",
    surface: "Documentation (specs, history, state, learnings)",
    checks: ["node scripts/docsCheck.mjs"],
  },
];

function getChangedFiles() {
  const files = new Set();
  const run = (cmd) => {
    try {
      return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return "";
    }
  };

  // Determine merge base against origin/main or local main
  let baseRef = null;
  for (const candidate of ["origin/main", "main"]) {
    if (run(`git rev-parse --verify ${candidate}`)) {
      baseRef = candidate;
      break;
    }
  }

  if (baseRef) {
    // Compare current branch against merge base with baseRef (three dots), excluding upstream-only commits
    const diffMain = run(`git diff --name-only ${baseRef}...HEAD`);
    if (diffMain) {
      diffMain.split("\n").forEach((f) => {
        if (f) {
          files.add(f.replace(/\\/g, "/"));
        }
      });
    }
  } else {
    console.warn(
      "Blast Radius: Warning: Could not determine a reliable base branch (neither origin/main nor main found).",
    );
  }

  // Always include uncommitted staged and unstaged files (-z handles renames as NUL-delimited dest and orig)
  let status = "";
  try {
    status = execSync("git status --porcelain -z", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    status = "";
  }
  const entries = status.split("\0");
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry && entry.length >= 4) {
      const code = entry.slice(0, 2);
      files.add(entry.slice(3).replace(/\\/g, "/"));
      if (code.includes("R") || code.includes("C")) {
        i += 1;
        const origin = entries[i];
        if (origin) {
          files.add(origin.replace(/\\/g, "/"));
        }
      }
    }
  }

  return [...files].sort();
}

const changed = getChangedFiles();

if (changed.length === 0) {
  console.log("Blast Radius: No changed files detected in working tree or branch.");
  process.exit(0);
}

console.log(`\n=== Blast Radius Advisory (${changed.length} files touched) ===\n`);

const matchedSurfaces = new Map();
const recommendedChecks = new Set();
let highestRisk = "LOW";

for (const file of changed) {
  let matched = false;
  for (const rule of SHARED_RULES) {
    if (rule.pattern.test(file)) {
      matched = true;
      if (rule.risk === "HIGH") highestRisk = "HIGH";
      else if (rule.risk === "MEDIUM" && highestRisk !== "HIGH") highestRisk = "MEDIUM";

      const list = matchedSurfaces.get(rule.surface) || [];
      list.push(file);
      matchedSurfaces.set(rule.surface, list);
      rule.checks.forEach((c) => {
        recommendedChecks.add(c);
      });
      break;
    }
  }
  if (!matched) {
    const list = matchedSurfaces.get("Isolated Feature / Other") || [];
    list.push(file);
    matchedSurfaces.set("Isolated Feature / Other", list);
  }
}

console.log(`Risk Assessment: ${highestRisk} BLAST RADIUS\n`);

const showAll = process.argv.includes("--all");

for (const [surface, files] of matchedSurfaces.entries()) {
  console.log(`Surface: ${surface}`);
  const displayFiles = showAll ? files : files.slice(0, 5);
  displayFiles.forEach((f) => {
    console.log(`  - ${f}`);
  });
  if (!showAll && files.length > 5) {
    console.log(`  ... and ${files.length - 5} more`);
  }
  console.log("");
}

if (recommendedChecks.size > 0) {
  console.log("Recommended Verification Checks:");
  for (const check of recommendedChecks) {
    console.log(`  -> ${check}`);
  }
  console.log("");
}

if (process.argv.includes("--strict") && highestRisk === "HIGH") {
  console.error(
    "Blast radius check failed: High-risk shared core files were modified (--strict enabled).\n",
  );
  process.exit(1);
}

process.exit(0);
