import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  entryScripts,
  FIRST_LOAD_BUDGET_BYTES,
  FONT_BUDGET_BYTES,
  findRenderBlockingScripts,
  firstLoadReport,
  gzipBytes,
  overBudget,
  unallowedInlineScripts,
  unhintedModules,
  wakeModules,
} from "../src/lib/bundleBudget";
import { linkCardProblems } from "../src/lib/linkCard";

/**
 * Fails the build when a page loads more than the first-load budget of gzipped JavaScript, when any
 * script blocks rendering, when the fonts exceed 80 KB, or when an inline script is not allowed by the
 * page's Content-Security-Policy, or when a module the page loads at start has no modulepreload link
 * (the build's `singularity-module-preload` step adds them), or when a briefing or episode page has no
 * link card or names a cover the build does not hold (D153). Run after a build.
 *
 * Usage: npx tsx apps/web/scripts/checkBundle.ts [build output directory]
 */

const HERE = dirname(fileURLToPath(import.meta.url));
// A static-only build (local Windows runs, e2e) writes to dist; the Vercel adapter build to .vercel.
const defaultOutput =
  (process.env.SINGULARITY_STATIC_ONLY ?? process.env.DISPATCH_STATIC_ONLY) === "1"
    ? join(HERE, "..", "dist")
    : join(HERE, "..", ".vercel", "output", "static");
const root = resolve(process.argv[2] ?? defaultOutput);
if (!existsSync(root)) {
  console.error(`No build output at ${root}. Run the build first.`);
  process.exit(1);
}

function pagesIn(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => join(entry.parentPath, entry.name));
}

const read = (url: string): string | null => {
  const file = join(root, url);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
};

const kilobytes = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
const failures: string[] = [];
let largest = 0;

for (const page of pagesIn(root)) {
  const name = page.slice(root.length).replaceAll("\\", "/");
  const html = readFileSync(page, "utf8");
  const report = firstLoadReport(entryScripts(html), read);
  largest = Math.max(largest, report.totalGzip);
  const woken = [...new Set(wakeModules(html, read).flat())];
  const wakeBytes = woken.reduce((sum, url) => sum + gzipBytes(read(url) ?? ""), 0);
  const onWake = woken.length > 0 ? `, ${kilobytes(wakeBytes)} more on wake` : "";
  console.log(
    `${name.padEnd(34)} ${kilobytes(report.totalGzip).padStart(9)} gzipped JS in ${report.files.length} files${onWake}`,
  );
  failures.push(...overBudget([{ name, totalGzip: report.totalGzip }]));
  for (const problem of findRenderBlockingScripts(html)) failures.push(`${name}: ${problem}`);
  const unhinted = unhintedModules(html, read);
  if (unhinted.length > 0) {
    failures.push(
      `${name}: ${unhinted.length} module(s) load at start with no modulepreload link, first ${unhinted[0]}`,
    );
  }
  if (/^\/(d|e)\//.test(name)) {
    for (const problem of linkCardProblems(html, (path) => existsSync(join(root, path)))) {
      failures.push(`${name}: link card: ${problem}`);
    }
  }
  for (const hash of unallowedInlineScripts(html)) {
    failures.push(`${name}: inline script ${hash} is not allowed by the Content-Security-Policy`);
  }
}

const assets = join(root, "_astro");
const fonts = existsSync(assets)
  ? readdirSync(assets).filter((file) => file.endsWith(".woff2"))
  : [];
const fontBytes = fonts.reduce((sum, file) => sum + statSync(join(assets, file)).size, 0);
console.log(
  `Fonts: ${fonts.length} files, ${kilobytes(fontBytes)} (budget ${kilobytes(FONT_BUDGET_BYTES)})`,
);
if (fontBytes > FONT_BUDGET_BYTES)
  failures.push(`Fonts total ${kilobytes(fontBytes)}, budget ${kilobytes(FONT_BUDGET_BYTES)}`);

// Development tools (src/dev) must never be built into the site.
const DEV_ONLY = /agentation/i;
for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !/\.(js|mjs|html|css)$/.test(entry.name)) continue;
  const file = join(entry.parentPath, entry.name);
  if (DEV_ONLY.test(entry.name) || DEV_ONLY.test(readFileSync(file, "utf8"))) {
    failures.push(
      `${file.slice(root.length).replaceAll("\\", "/")}: a development-only tool is in the build`,
    );
  }
}

console.log(`Largest first load: ${kilobytes(largest)} of ${kilobytes(FIRST_LOAD_BUDGET_BYTES)}`);
if (failures.length > 0) {
  console.error(`\n${failures.length} problem(s):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("Bundle budget met.");
