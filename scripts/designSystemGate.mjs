// The design system is a product with one owner: its changes travel in pull requests of their own.
// A pull request that touches the system carries the `design-system` label, and one that carries the
// label holds nothing but the system, the app files that draw it, the guide and the record.
// Usage in CI: LABELS='["design-system"]' BASE=<sha> node scripts/designSystemGate.mjs
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LABEL = "design-system";

/** What the owner reviews: the components, the stylesheets they share, the tokens and the guide. */
export const SYSTEM_PATHS = [
  "apps/web/src/design-system/",
  "apps/web/src/styles/buttons.css",
  "apps/web/src/styles/icon.css",
  "apps/web/src/styles/badge.css",
  "apps/web/src/styles/switch.css",
  "apps/web/src/styles/slider.css",
  "apps/web/src/styles/field.css",
  "apps/web/src/styles/select.css",
  "apps/web/src/styles/picker.css",
  "apps/web/src/styles/wheel.css",
  "apps/web/src/styles/ripple.css",
  "apps/web/src/styles/menu.css",
  "apps/web/src/styles/banner.css",
  "apps/web/src/styles/dialog.css",
  "apps/web/src/styles/sheet.css",
  "apps/web/src/styles/drawer.css",
  "apps/web/src/styles/primitives.css",
  "apps/web/src/styles/foundations.css",
  "apps/web/src/styles/tokens.css",
  "tokens/",
  "apps/design/",
  "scripts/system/",
  "scripts/colorRamp.ts",
  "scripts/styleRecipe",
  ".github/CODEOWNERS",
  ".claude/skills/feature/references/controls-guide.md",
];

/**
 * What a design-system pull request may change besides the system itself (owner, 2026-10-29: "have it
 * stricter"). Records and tooling by exact path; app code only where it draws or restyles the system.
 */
const MAY_CHANGE = [
  ...SYSTEM_PATHS,
  "docs/decisions/",
  "docs/history/",
  "docs/design-engineering-ledger.md",
  "docs/ledger/",
  "docs/specs/look-and-sound.md",
  // A spec that names a class a family retired (the Costs chips were the shared `.sort-field`).
  "docs/specs/costs.md",
  // The guide's own record and wiring (owner, 2026-10-30): its spec, its plan, the specs index, the
  // icons built from tokens/glyphs.json, and the gate that type checks the app.
  "docs/specs/style-guide.md",
  "docs/design/command-center.md",
  "docs/specs/README.md",
  "apps/web/src/lib/icons.ts",
  // The rest of what tokens/glyphs.json builds: the player's two registries, the generator and its
  // test. glyphs.json is a system path, and a change to it (a bold twin per glyph, D274) must
  // regenerate all three registries in the same pull request or `glyphs --check` fails.
  "apps/web/src/player/ui/iconPaths.tsx",
  "apps/web/src/player/ui/iconPathsLazy.tsx",
  "scripts/buildGlyphs.ts",
  "scripts/buildGlyphs.test.ts",
  // The cover is a shared component outside design-system/; its corner rule (D268) follows the
  // cover-radius tokens, so a token change that needs a cap changes this stylesheet with it.
  "apps/web/src/styles/cover.css",
  "scripts/gate.mjs",
  "docs/state.md",
  // The Icon moved into the system (D266); its old path is deleted.
  "apps/web/src/components/Icon.astro",
  "docs/learnings.md",
  "scripts/designSystemGate",
  "scripts/buildTokens",
  ".github/workflows/design-system.yml",
  ".claude/skills/feature/",
  "AGENTS.md",
  "package.json",
  "package-lock.json",
];

/** App code a labelled pull request may touch, but only a file that names the system (see below). */
const CALL_SITES = ["apps/web/src/", "apps/web/e2e/", "apps/admin/src/"];

/**
 * The names that make a file a call site: the components, their helpers and the classes they
 * replaced. A family's pull request adds the names it retires here, so its own call sites count.
 */
export const SYSTEM_NAMES =
  /\bButton\b|buttonClass|<(?:Lazy)?Icon(?![\w.])|<Badge(?![\w.])|PlayPauseIcons|badgeClass|badge-label|iconClass|iconHtml|icon-glyph|text-(?:display|title|heading)\b|button-(?:filled|tonal|text|danger)|\bbtn\b|btn-primary|btn-secondary|confirm-delete|\bSwitch\b|\bSlider\b|switchClass|sliderClass|\.(?:switch|slider)-input\b|settings-switch|settings-range|speed-slider|<Field(?![\w.])|fieldClass|field-input|manage-input|sheet-input|<Select(?![\w.])|selectClass|selectSheet|data-select-sheet|select-(?:outlined|tonal)|manage-select|sort-field|create-select|styles\/(?:menu|select|sheet|drawer)\.css|data-sheet=|MENU_SELECTORS|<Menu(?:Item)?(?![\w.])|menuItemClass|menuListClass|menu-(?:list|item)|hero-menu-(?:list|item|delete)|<LibraryItemMenu(?![\w.])|sheetHeadHtml|<Ripple(?![\w.])|installRipple|data-ripple|<Banner(?![\w.])|bannerClass|bannerText|player-notice|<Dialog(?:Actions)?(?![\w.])|dialogClass|dialogActionsClass|dialogBodyClass|DIALOG_SELECTOR|confirm-(?:dialog|form|actions)|<DialogTitle|dialogTitleClass|<Sheet(?![\w.])|sheet(?:Body|Head|Title)?Class|(?:CREATE_|PANEL_)?SHEET_SELECTOR|create-sheet(?:-head|-body)?\b|drawer(?:Scrim|Viewport|Popup|Panel|Head)Class|sheet-(?:scrim|viewport|popup|panel)/;

const startsWithAny = (file, prefixes) => prefixes.some((prefix) => file.startsWith(prefix));

/** The problems with a pull request, given its changed files and labels. Empty means it may go on. */
export function checkDesignSystemPr({ files, labels, namesSystem = () => false }) {
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
    for (const file of files) {
      if (startsWithAny(file, MAY_CHANGE)) continue;
      if (startsWithAny(file, CALL_SITES) && namesSystem(file)) continue;
      problems.push(
        `${file} is not design-system work. A "${LABEL}" pull request holds the system, the app files that draw or restyle it, the guide and its records; this file goes in its own pull request.`,
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
  // lists only what the pull request changes. A local run (a feature branch that merged main has two
  // parents too, but its first is its own previous commit) compares against BASE instead.
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
  const merged =
    process.env.GITHUB_ACTIONS === "true" &&
    git("rev-list", "--parents", "-n", "1", "HEAD").trim().split(" ").length === 3;
  const files = git("diff", "--name-only", ...(merged ? ["HEAD^1", "HEAD"] : [`${base}...HEAD`]))
    .split("\n")
    .filter(Boolean);
  // A call site is a file that names the system before or after the change (a deleted one, before).
  const before = merged ? "HEAD^1" : base;
  const show = (rev, file) => {
    try {
      return git("show", `${rev}:${file}`);
    } catch {
      return "";
    }
  };
  const namesSystem = (file) =>
    SYSTEM_NAMES.test(show("HEAD", file)) || SYSTEM_NAMES.test(show(before, file));
  const problems = checkDesignSystemPr({ files, labels, namesSystem });
  for (const problem of problems) console.log(`::error::${problem}`);
  console.log(
    problems.length
      ? `design-system gate: ${problems.length} problem(s)`
      : `design-system gate passed (${files.length} files, labels: ${labels.join(", ") || "none"})`,
  );
  process.exit(problems.length ? 1 : 0);
}
