// The design system is a product with one owner: its changes travel in pull requests of their own.
// A pull request that touches the system carries the `design-system` label, and one that carries the
// label holds nothing but the system, the app code that calls it, the guide and the record.
// Usage in CI: LABELS='["design-system"]' BASE=<sha> node scripts/designSystemGate.mjs
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LABEL = "design-system";

/** What the owner reviews: the components, the stylesheets they share, the tokens and the guide. */
export const SYSTEM_PATHS = [
  "apps/web/src/design-system/",
  "apps/web/src/styles/buttons.css",
  "apps/web/src/styles/primitives.css",
  "apps/web/src/styles/foundations.css",
  "apps/web/src/styles/tokens.css",
  "tokens/",
  "apps/design/",
  ".github/CODEOWNERS",
];

/** Where a design-system pull request may change files: the system itself and what moves with it. */
const MAY_CHANGE = [
  ...SYSTEM_PATHS,
  "apps/web/",
  "docs/",
  "scripts/designSystemGate",
  ".github/workflows/design-system.yml",
  ".claude/",
  "AGENTS.md",
  "package.json",
  "package-lock.json",
];

const startsWithAny = (file, prefixes) => prefixes.some((prefix) => file.startsWith(prefix));

/** The problems with a pull request, given its changed files and labels. Empty means it may go on. */
export function checkDesignSystemPr({ files, labels }) {
  const labelled = labels.includes(LABEL);
  const touched = files.filter((file) => startsWithAny(file, SYSTEM_PATHS));
  const problems = [];
  if (touched.length > 0 && !labelled) {
    problems.push(
      `This pull request changes the design system (${touched.slice(0, 3).join(", ")}` +
        `${touched.length > 3 ? `, and ${touched.length - 3} more` : ""}), so it needs the ` +
        `"${LABEL}" label and the owner's merge. Add the label, or move the system change to its own pull request.`,
    );
  }
  if (labelled) {
    const strays = files.filter((file) => !startsWithAny(file, MAY_CHANGE));
    for (const file of strays) {
      problems.push(
        `${file} is not design-system work. A "${LABEL}" pull request holds the system, the app code that calls it, the guide and the docs; this file goes in its own pull request.`,
      );
    }
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.env.BASE;
  const labels = JSON.parse(process.env.LABELS ?? "[]");
  if (!base) {
    console.error("BASE (the pull request's base commit) is required.");
    process.exit(2);
  }
  // CI checks out the pull request merged into the base as it is now, which can be newer than the
  // base commit the event names; the merge's first parent is that newer base, so diffing against it
  // lists only what the pull request changes. Without a merge commit (a local run) fall back to BASE.
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
  const merged = git("rev-list", "--parents", "-n", "1", "HEAD").trim().split(" ").length === 3;
  const files = git("diff", "--name-only", merged ? "HEAD^1" : `${base}...HEAD`, "HEAD")
    .split("\n")
    .filter(Boolean);
  const problems = checkDesignSystemPr({ files, labels });
  for (const problem of problems) console.log(`::error::${problem}`);
  console.log(
    problems.length
      ? `design-system gate: ${problems.length} problem(s)`
      : `design-system gate passed (${files.length} files, labels: ${labels.join(", ") || "none"})`,
  );
  process.exit(problems.length ? 1 : 0);
}
