#!/usr/bin/env node
// Advisory blast-radius tool: inspects touched files and reports affected consumer surfaces
// and recommended verification commands. Non-blocking (exits 0 by default).
//
// Usage: node scripts/blastRadius.mjs [--all] [--strict]
import { execFileSync } from "node:child_process";

const SHARED_RULES = [
  {
    pattern: /^tokens\//,
    risk: "HIGH",
    surface: "Design Tokens (all pages: color, typography, spacing, elevation)",
    checks: ["npm run design-check", "npm run e2e -w @singularity/web -- e2e/designSystem.spec.ts"],
  },
  {
    pattern:
      /^apps\/web\/src\/styles\/(?:tokens|primitives|buttons|shell|foundations|player|sheets)\.css$/,
    risk: "HIGH",
    surface: "Shared CSS Primitives (buttons, chips, navigation, sheets across all pages)",
    checks: ["npm run design-check", "npm run e2e -w @singularity/web -- e2e/designSystem.spec.ts"],
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
      "npm run e2e -w @singularity/web -- e2e/create.spec.ts",
    ],
  },
  {
    pattern: /^apps\/web\/src\/(?:pages\/settings|scripts\/structure|lib\/structure)/,
    risk: "MEDIUM",
    surface: "Settings & Preferences (podcast structure, categories, voice, sound)",
    checks: [
      "npx vitest run apps/web/src/lib/structureView.test.ts",
      "npm run e2e -w @singularity/web -- e2e/settings.spec.ts e2e/topics.spec.ts",
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

// Runs git and returns its stdout, or null when git exits non-zero. Callers decide whether that is
// fatal (no git worktree) or expected (a base ref that does not exist).
function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

const posix = (path) => path.replace(/\\/g, "/");

function getChangedFiles() {
  if (git(["rev-parse", "--is-inside-work-tree"]) === null) {
    console.error("Blast Radius: not inside a git worktree, so there is nothing to compare.");
    process.exit(1);
  }

  const files = new Set();
  // --no-renames lists both sides of a move, so a HIGH path that moved away is still seen.
  // -z keeps names with spaces or non-ASCII characters unquoted.
  const baseRef = ["origin/main", "main"].find(
    (ref) => git(["rev-parse", "--verify", ref]) !== null,
  );
  if (baseRef) {
    // Three dots: this branch's own changes since it left baseRef, not what landed on baseRef since.
    const diff = git(["diff", "--no-renames", "--name-only", "-z", `${baseRef}...HEAD`]);
    if (diff === null) {
      console.warn(
        `Blast Radius: could not compare against ${baseRef}...HEAD (no merge base? shallow clone?). Run 'git fetch --unshallow'.`,
      );
    } else {
      for (const file of diff.split("\0")) if (file) files.add(posix(file));
    }
  } else {
    console.warn(
      "Blast Radius: neither origin/main nor main exists; only uncommitted files are listed.",
    );
  }

  // Uncommitted work, staged or not, including each file inside a new directory.
  const status = git(["status", "--porcelain", "--no-renames", "-z", "--untracked-files=all"]);
  if (status === null) {
    console.error("Blast Radius: git status failed.");
    process.exit(1);
  }
  for (const entry of status.split("\0")) if (entry.length > 3) files.add(posix(entry.slice(3)));

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
