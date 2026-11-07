// The design system's move into packages/design-system (D382 step 4). A branch opened before the move
// runs this once after it merges: `node scripts/dsMigrate.mjs` (add `--dry` to list what it would do).
// It moves any file the branch added under an old system path, then rewrites every import that still
// points at an old path: relative inside the package, `@singularity/design-system/...` from outside.
// It is idempotent: an import that already resolves is left alone. Paths read by `fs` at run time
// (join(root, "tokens", ...)) are not imports; grep for the old paths after running it.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE = "packages/design-system/";
export const PACKAGE_NAME = "@singularity/design-system";

const SYSTEM_STYLES = [
  "buttons",
  "icon",
  "badge",
  "flag",
  "code",
  "glow",
  "fonts",
  "switch",
  "slider",
  "avatar",
  "row-exit",
  "field",
  "select",
  "picker",
  "wheel",
  "ripple",
  "menu",
  "banner",
  "dialog",
  "sheet",
  "drawer",
  "primitives",
  "foundations",
  "tokens",
];

/** Old path to new path. A key ending in "/" moves a folder, any other key one file. */
export const PATH_MAP = {
  "apps/web/src/design-system/": `${PACKAGE}src/`,
  ...Object.fromEntries(
    SYSTEM_STYLES.map((name) => [
      `apps/web/src/styles/${name}.css`,
      `${PACKAGE}styles/${name}.css`,
    ]),
  ),
  "apps/web/src/assets/fonts/": `${PACKAGE}fonts/`,
  "apps/web/public/flags/": `${PACKAGE}flags/`,
  "tokens/": `${PACKAGE}tokens/`,
  "scripts/system/": `${PACKAGE}scripts/system/`,
  "scripts/colorRamp.ts": `${PACKAGE}scripts/colorRamp.ts`,
  "scripts/styleRecipe.ts": `${PACKAGE}scripts/styleRecipe.ts`,
  "scripts/styleRecipe.test.ts": `${PACKAGE}scripts/styleRecipe.test.ts`,
  "scripts/buildTokens.ts": `${PACKAGE}scripts/buildTokens.ts`,
  "scripts/buildTokens.test.ts": `${PACKAGE}scripts/buildTokens.test.ts`,
};

/** Where a repo path lives after the move; a path the move does not name keeps its place. */
export function movedPath(path) {
  for (const [from, to] of Object.entries(PATH_MAP)) {
    if (from.endsWith("/") ? path.startsWith(from) : path === from)
      return to + path.slice(from.length);
  }
  return path;
}

/** Where a path lived before the move: the inverse of movedPath. */
export function originalPath(path) {
  for (const [from, to] of Object.entries(PATH_MAP)) {
    if (to.endsWith("/") ? path.startsWith(to) : path === to) return from + path.slice(to.length);
  }
  return path;
}

const SCRIPT_EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs", ".astro"];

/** The file a specifier names, as a bundler finds it: as written, .js for .ts, or an added extension. */
export function resolveFile(target, exists) {
  return candidates(target).find(exists);
}

/** The files a specifier may name, in the order a bundler tries them. */
function candidates(target) {
  const bare = target.replace(/\.(?:js|mjs)$/, "");
  return [target, ...SCRIPT_EXTENSIONS.map((extension) => bare + extension)];
}

/** The package specifier for a file inside the package, as its `exports` map serves it. */
export function packageSpecifier(file) {
  const inside = file.slice(PACKAGE.length);
  if (inside.startsWith("src/")) {
    const name = inside.slice("src/".length);
    return `${PACKAGE_NAME}/${name.endsWith(".astro") ? name : name.replace(/\.tsx?$/, "")}`;
  }
  if (inside.startsWith("scripts/")) return `${PACKAGE_NAME}/${inside.replace(/\.ts$/, "")}`;
  return `${PACKAGE_NAME}/${inside}`;
}

/** A relative specifier from one repo file to another, in the style the old one was written. */
function relativeSpecifier(from, to, written) {
  let path = posix.relative(posix.dirname(from), to);
  if (!path.startsWith(".")) path = `./${path}`;
  const extension = posix.extname(to);
  if ([".ts", ".tsx"].includes(extension)) {
    const writtenExtension = posix.extname(written);
    if (writtenExtension === ".js") return `${path.slice(0, -extension.length)}.js`;
    if (writtenExtension !== extension) return path.slice(0, -extension.length);
  }
  return path;
}

// `from "x"`, `import "x"`, `import("x")`, `@import "x"`, `url("x")` and `new URL("x", import.meta.url)`.
const SPECIFIERS =
  /(\bfrom\s*|\bimport\s*\(?\s*|@import\s+(?:url\(\s*)?|\burl\(\s*|new URL\(\s*)(["'])(\.{1,2}\/[^"'\n]*)\2/g;

/**
 * The text of `file` (its path now, repo-relative) with each import of an old path pointed at the new
 * one. `exists` says whether a repo-relative path is a file in the new layout. `packageImports` is
 * false where only a relative path works (a file outside every workspace package).
 */
export function rewriteSource(text, file, exists, { packageImports = true } = {}) {
  const was = originalPath(file);
  return text.replace(SPECIFIERS, (whole, lead, quote, specifier) => {
    const [path, query = ""] = specifier.split(/(?=[?#])/);
    // Already right: it resolves where the file stands now.
    const now = resolveFile(posix.join(posix.dirname(file), path), exists);
    // Where the import pointed before the move, and where that file is now.
    const old = posix.join(posix.dirname(was), path);
    if (old.startsWith("..")) return whole;
    const named = candidates(old).find((candidate) => exists(movedPath(candidate)));
    if (!named) return whole;
    const target = movedPath(named);
    // A target that stayed put and an import that resolves: nothing moved under it.
    if (target === now || (now && target === named)) return whole;
    const toPackage = target.startsWith(PACKAGE) && !file.startsWith(PACKAGE);
    const wanted =
      toPackage && packageImports && !lead.startsWith("new URL") && !lead.startsWith("url(")
        ? packageSpecifier(target)
        : relativeSpecifier(file, target, path);
    return `${lead}${quote}${wanted}${query}${quote}`;
  });
}

const SOURCE = /\.(?:ts|tsx|mts|js|mjs|astro|css)$/;
// Its own test holds old imports as fixtures.
const SKIP =
  /^(?:Digests|state|Podcasts|Pools)\/|^scripts\/dsMigrate\.|(?:^|\/)(?:node_modules|dist|\.astro|\.vercel)\//;

function run({ root, dry }) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const listed = () =>
    git("ls-files", "--cached", "--others", "--exclude-standard")
      .split("\n")
      .filter((file) => file && existsSync(resolve(root, file)));
  // 1. A file the branch added under an old path moves with the rest.
  const tracked = new Set(git("ls-files").split("\n"));
  for (const file of listed()) {
    const to = movedPath(file);
    if (to === file) continue;
    console.log(`move ${file} -> ${to}`);
    if (dry) continue;
    mkdirSync(resolve(root, posix.dirname(to)), { recursive: true });
    if (tracked.has(file)) git("mv", file, to);
    else renameSync(resolve(root, file), resolve(root, to));
  }
  // 2. Every import of an old path points at the new one.
  const files = dry ? listed().map(movedPath) : listed();
  const present = new Set(files);
  const exists = (path) => present.has(path);
  let changed = 0;
  for (const file of files.filter((path) => SOURCE.test(path) && !SKIP.test(path))) {
    const full = resolve(root, dry ? originalPath(file) : file);
    if (!existsSync(full)) continue;
    const text = readFileSync(full, "utf8");
    const packageImports = /^(?:apps|packages)\/|^scripts\//.test(file);
    const next = rewriteSource(text, file, exists, { packageImports });
    if (next === text) continue;
    changed += 1;
    console.log(`rewrite ${file}`);
    if (!dry) writeFileSync(full, next);
  }
  console.log(`${changed} file(s) ${dry ? "would change" : "changed"}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run({ root: process.cwd(), dry: process.argv.includes("--dry") });
}
