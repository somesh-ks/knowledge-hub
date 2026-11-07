// The design system is a product with one owner: its changes travel in pull requests of their own.
// A pull request that touches the system carries the `design-system` label, and one that carries the
// label holds nothing but the system, the app files that draw it, the guide and the record. An entry
// added to a list that excuses code from a system check is a system change too.
// Usage in CI: LABELS='["design-system"]' BASE=<sha> node scripts/designSystemGate.mjs
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LABEL = "design-system";

/**
 * The label of the one pull request that moves the system to its package (D382 step 4). While one
 * is open, every other pull request that touches a system path fails, so nothing lands on the old
 * paths mid-move; the freeze ends when it merges, and an open branch then runs the committed codemod.
 * The move itself touches manifests, the lockfile and workflows, so the scope check does not hold it.
 */
export const MIGRATION_LABEL = "ds-migration";

/** What the owner reviews: the components, the stylesheets they share, the tokens and the guide. */
export const SYSTEM_PATHS = [
  // The package (D382 step 4): the components and their behaviour (src/), the stylesheets they share
  // (styles/), the type families' files (fonts/), the Flag's art (flags/, D367), the tokens, and the
  // token and system generators (scripts/).
  "packages/design-system/",
  "apps/design/",
  ".github/CODEOWNERS",
  ".claude/skills/feature/references/controls-guide.md",
  // How the package is released (D382 step 5): its pending changesets and the publishing workflow.
  ".changeset/",
  ".github/workflows/release.yml",
];

/**
 * Files under a system path that build and deploy the guide like any other app: its manifest, its
 * Vercel config and its build filter. A repo-wide tooling change (npm to pnpm, D382) edits them in
 * every app at once, so they are not system work, and a design-system pull request may still carry them.
 */
const WORKSPACE_PLUMBING = [
  "packages/design-system/package.json",
  "apps/design/package.json",
  "apps/design/vercel.json",
  "apps/design/ignore-build.sh",
];

/**
 * What a design-system pull request may change besides the system itself (owner, 2026-10-29: "have it
 * stricter"). Records and tooling by exact path; app code only where it draws or restyles the system.
 */
const MAY_CHANGE = [
  ...SYSTEM_PATHS,
  // A file moved into the system moves its path in the admin's build filter and the blast-radius map.
  "apps/admin/ignore-build.sh",
  "scripts/blastRadius.mjs",
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
  // The rest of what tokens/glyphs.json builds: the player's two registries, the generator and its
  // test. glyphs.json is a system path, and a change to it (a bold twin per glyph, D274) must
  // regenerate all three registries in the same pull request or `glyphs --check` fails.
  "apps/web/src/player/ui/iconPaths.tsx",
  "apps/web/src/player/ui/iconPathsLazy.tsx",
  "scripts/buildGlyphs.ts",
  "scripts/buildGlyphs.test.ts",
  // The codemod that moved the system into its package, and its test.
  "scripts/dsMigrate",
  // The cover is a shared component outside design-system/; its corner rule (D268) follows the
  // cover-radius tokens, so a token change that needs a cap changes this stylesheet with it.
  "apps/web/src/styles/cover.css",
  // Stylesheets held to defined tokens (scripts/houseRules.test.ts): a token the system removes
  // changes them with it (D378 folded --color-on-surface-subtle).
  "scripts/prototype/ui-prototype.css",
  "scripts/soundLab/sound-lab.css",
  "scripts/houseRules.test.ts",
  "scripts/gate.mjs",
  "docs/state.md",
  // The Icon moved into the system (D266), and the BrandMark, the shell and utility stylesheets and the
  // head's theme script (D382 step 4c); their old paths are deleted.
  "apps/web/src/components/Icon.astro",
  "apps/web/src/components/BrandMark.astro",
  "apps/web/src/styles/shell.css",
  "apps/web/src/styles/utilities.css",
  "apps/web/src/scripts/themeInit.js",
  // The reader keeps the head script's back bridge, and hashes it and the system's theme script.
  "apps/web/src/scripts/backInit.js",
  "apps/web/astro.config.mjs",
  // The checks of how the apps draw the system, and the writer that passes them into the system file:
  // they read the apps, so they live outside the package (D382 step 4c).
  "scripts/system",
  "docs/learnings.md",
  "scripts/designSystemGate",
  ".github/workflows/design-system.yml",
  // The package as a customer installs it (D382 step 5): the pack-and-install check and its CI step, and
  // the consumers' manifests, which reach the published name through a workspace alias.
  "scripts/designSystemPack.mjs",
  ".github/workflows/ci.yml",
  "apps/web/package.json",
  "apps/admin/package.json",
  "packages/cover/package.json",
  ".claude/skills/feature/",
  "AGENTS.md",
  "package.json",
  "pnpm-lock.yaml",
];

/** App code a labelled pull request may touch, but only a file that names the system (see below). */
const CALL_SITES = ["apps/web/src/", "apps/web/e2e/", "apps/admin/src/"];

/**
 * The names that make a file a call site: the components, their helpers and the classes they
 * replaced. A family's pull request adds the names it retires here, so its own call sites count.
 */
export const SYSTEM_NAMES =
  /\bdesign-system\/|--ghost-(?:accent-)?(?:hover|pressed)\b|\btabs-bar\b|\bButton\b|buttonClass|<(?:Lazy)?Icon(?![\w.])|<Badge(?![\w.])|<Flag(?![\w.])|<Code(?![\w.])|codeSnippetHtml|wireCodeCopy|styles\/code\.css|glowFavorite|--radius-round\b|styles\/glow\.css|flagNode|flagParts|showText|shownText|FLAG_REGIONS|flagSymbolId|styles\/flag\.css|<RowExit(?![\w.])|rowExitClass|<Avatar(?![\w.])|avatarMarkup|avatarClass|PlayPauseIcons|badgeClass|badge-label|iconClass|iconHtml|icon-glyph|text-(?:display|title|heading)\b|button-(?:filled|tonal|text|danger)|\bbtn\b|btn-primary|btn-secondary|confirm-delete|\bSwitch\b|\bSlider\b|switchClass|sliderClass|\.(?:switch|slider)-input\b|settings-switch|settings-range|speed-slider|<Field(?![\w.])|fieldClass|field-input|manage-input|sheet-input|<Select(?![\w.])|selectClass|selectSheet|data-select-sheet|select-(?:outlined|tonal)|manage-select|sort-field|create-select|styles\/(?:menu|select|sheet|drawer)\.css|data-sheet=|MENU_SELECTORS|<Menu(?:Item)?(?![\w.])|menuItemClass|menuListClass|menu-(?:list|item)|hero-menu-(?:list|item|delete)|<LibraryItemMenu(?![\w.])|sheetHeadHtml|<Ripple(?![\w.])|installRipple|data-ripple|<Banner(?![\w.])|bannerClass|bannerText|player-notice|<Dialog(?:Actions)?(?![\w.])|dialogClass|dialogActionsClass|dialogBodyClass|DIALOG_SELECTOR|confirm-(?:dialog|form|actions)|<DialogTitle|dialogTitleClass|<Sheet(?![\w.])|sheet(?:Body|Head|Title)?Class|(?:CREATE_|PANEL_)?SHEET_SELECTOR|create-sheet(?:-head|-body)?\b|drawer(?:Scrim|Viewport|Popup|Panel|Head)Class|sheet-(?:scrim|viewport|popup|panel)/;

const PACKAGE_DIR = "packages/design-system/";
const SOURCE_FILE = /\.(?:ts|tsx|astro|mjs|js)$/;
const IMPORT = /(?:from|import)\s*\(?\s*["']([^"'\s]+)["']/g;
/** The workspace package the system may name: itself. It depends on none (D382 step 4c). */
const WORKSPACE_ALLOWED = ["@singularity/design-system"];

/**
 * The design system must not import app code, so it can leave for a repository of its own (D382,
 * step 6 filters the package into one). Every file in the package (src/ and scripts/) may import
 * only what stays inside it by a relative path, or a package by name: node: or a third-party
 * package, never another workspace package. `sources` is each file's repo-relative path and text; the result names each
 * import that reaches out, as "file: specifier".
 */
export function boundaryProblems(sources) {
  return sources.flatMap(({ file, text }) =>
    [...text.matchAll(IMPORT)].flatMap(([, specifier]) => {
      if (specifier.startsWith(".")) {
        const target = posix.join(posix.dirname(file), specifier.replace(/[?#].*$/, ""));
        return target.startsWith(PACKAGE_DIR) ? [] : [`${file}: ${specifier}`];
      }
      if (specifier.startsWith("/")) return [`${file}: ${specifier}`];
      const workspace = /^@singularity\/[^/]+/.exec(specifier)?.[0];
      return workspace && !WORKSPACE_ALLOWED.includes(workspace) ? [`${file}: ${specifier}`] : [];
    }),
  );
}

/** Every source file in the package (its dependencies left out), as boundaryProblems reads them. */
export function systemSources(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = posix.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(path);
      } else if (SOURCE_FILE.test(entry.name))
        found.push({ file: path, text: readFileSync(join(root, path), "utf8") });
    }
  };
  walk(PACKAGE_DIR.slice(0, -1));
  return found;
}

const startsWithAny = (file, prefixes) => prefixes.some((prefix) => file.startsWith(prefix));

/**
 * The lists that excuse code from a design-system check, by the file that holds them. Any pull request
 * may shrink one; an entry added is a design decision (a control drawn by hand, a page bending a
 * component, an outlined control), so it needs the label and the owner's merge (2026-11-04: any pull
 * request could add a bespoke class and silence the button rule). A list inside the package would
 * not be named here: every change there is a system change already.
 */
export const ALLOWLISTS = {
  "apps/web/src/styles/styles.test.ts": [
    "SHARED_CONTROLS",
    "BESPOKE_CONTROLS",
    "OUTLINED_CONTROLS",
    "PAGE_OVERRIDES",
  ],
  // The controls still written by hand and the popovers built outside Menu (D382 step 4c moved them
  // out of the package, beside the apps they read).
  "scripts/systemUse.test.ts": ["NOT_YET_COMPONENTS", "BUILT_OWN"],
};

/**
 * The entries of the array a source text declares as `const <name> ... = [...]`: each string, or each
 * tuple's first string. Undefined when the text declares no such list.
 */
export function listEntries(text, name) {
  const head = new RegExp(`const ${name}\\b[^=]*=\\s*\\[`).exec(text);
  if (!head) return undefined;
  const entries = [];
  let depth = 1;
  let first = false;
  for (let at = head.index + head[0].length; at < text.length && depth > 0; at += 1) {
    const character = text[at];
    if (character === "/" && text[at + 1] === "/") {
      const end = text.indexOf("\n", at);
      at = end < 0 ? text.length : end;
    } else if (character === "[") {
      depth += 1;
      first = true;
    } else if (character === "]") {
      depth -= 1;
    } else if (character === '"' || character === "'" || character === "`") {
      let end = at + 1;
      while (end < text.length && text[end] !== character) end += text[end] === "\\" ? 2 : 1;
      if (depth === 1 || first) entries.push(text.slice(at + 1, end));
      first = false;
      at = end;
    }
  }
  return entries;
}

/** What a change adds to a file's lists, as "LIST: entry": each entry beyond as many as it held. */
export function allowlistAdditions(before, after, lists) {
  return lists.flatMap((list) => {
    const held = new Map();
    for (const entry of listEntries(before, list) ?? [])
      held.set(entry, (held.get(entry) ?? 0) + 1);
    return (listEntries(after, list) ?? []).flatMap((entry) => {
      const count = held.get(entry) ?? 0;
      held.set(entry, count - 1);
      return count > 0 ? [] : [`${list}: ${entry}`];
    });
  });
}

/**
 * The problems with a pull request, given its changed files, its labels and what it adds to the
 * allowlists. Empty means it may go on.
 */
export function checkDesignSystemPr({
  files,
  labels,
  namesSystem = () => false,
  added = [],
  frozenBy = [],
}) {
  if (labels.includes(MIGRATION_LABEL)) return [];
  const labelled = labels.includes(LABEL);
  const touched = files.filter(
    (file) => startsWithAny(file, SYSTEM_PATHS) && !WORKSPACE_PLUMBING.includes(file),
  );
  const problems = [];
  if (touched.length > 0 && !labelled) {
    problems.push(
      `This pull request changes the design system (${touched.slice(0, 3).join(", ")}` +
        `${touched.length > 3 ? `, and ${touched.length - 3} more` : ""}), so it needs the ` +
        `"${LABEL}" label and the owner's merge. Add the label, or move the system change to its own pull request.`,
    );
  }
  if (touched.length > 0 && frozenBy.length > 0) {
    problems.push(
      `The design system is frozen while #${frozenBy.join(", #")} moves it to its package ` +
        `("${MIGRATION_LABEL}"). Wait for it to merge, run its codemod on this branch, and push again.`,
    );
  }
  if (added.length > 0 && !labelled) {
    problems.push(
      `This pull request adds to the lists that excuse code from the design system's checks ` +
        `(${added.slice(0, 3).join("; ")}${added.length > 3 ? `; and ${added.length - 3} more` : ""}), ` +
        `which only the owner grows. Draw it with the system instead, or add the "${LABEL}" label for the owner's merge.`,
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
  if (process.env.ADD_LABEL === "true" && !labels.includes(LABEL)) labels.push(LABEL);
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
  const added = Object.entries(ALLOWLISTS)
    .filter(([file]) => files.includes(file))
    .flatMap(([file, lists]) => allowlistAdditions(show(before, file), show("HEAD", file), lists));
  // The open move, if any, other than this pull request (CI passes GH_REPO and PR). A local run
  // skips the freeze.
  const frozenBy = process.env.GH_REPO
    ? execFileSync(
        "gh",
        [
          "api",
          `repos/${process.env.GH_REPO}/issues?state=open&labels=${MIGRATION_LABEL}&per_page=100`,
          "--jq",
          ".[] | select(.pull_request) | .number",
        ],
        { encoding: "utf8" },
      )
        .split("\n")
        .filter((number) => number && number !== process.env.PR)
        .map(Number)
    : [];
  const problems = checkDesignSystemPr({ files, labels, namesSystem, added, frozenBy });
  for (const reach of boundaryProblems(systemSources(process.cwd()))) {
    problems.push(
      `${reach} leaves the design system's package for app code. The system imports only its own files: move the module into packages/design-system/, or pass the value in as a prop.`,
    );
  }
  for (const problem of problems) console.log(`::error::${problem}`);
  console.log(
    problems.length
      ? `design-system gate: ${problems.length} problem(s)`
      : `design-system gate passed (${files.length} files, labels: ${labels.join(", ") || "none"})`,
  );
  process.exit(problems.length ? 1 : 0);
}
