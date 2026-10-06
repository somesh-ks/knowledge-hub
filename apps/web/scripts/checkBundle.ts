import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  entryScripts,
  FIRST_LOAD_BUDGET_BYTES,
  FONT_BUDGET_BYTES,
  findRenderBlockingScripts,
  firstLoadReport,
  unallowedInlineScripts,
} from "../src/lib/bundleBudget";

/**
 * Fails the build when a page loads more than 100 KB of gzipped JavaScript on first visit, when any
 * script blocks rendering, when the fonts exceed 80 KB, or when an inline script is not allowed by the
 * page's Content-Security-Policy. Run after a build.
 *
 * Usage: npx tsx apps/web/scripts/checkBundle.ts [build output directory]
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2] ?? join(HERE, "..", ".vercel", "output", "static"));
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
  console.log(
    `${name.padEnd(34)} ${kilobytes(report.totalGzip).padStart(9)} gzipped JS in ${report.files.length} files`,
  );
  if (report.totalGzip > FIRST_LOAD_BUDGET_BYTES) {
    failures.push(
      `${name}: ${kilobytes(report.totalGzip)} of first-load JavaScript, budget ${kilobytes(FIRST_LOAD_BUDGET_BYTES)}`,
    );
  }
  for (const problem of findRenderBlockingScripts(html)) failures.push(`${name}: ${problem}`);
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

console.log(`Largest first load: ${kilobytes(largest)} of ${kilobytes(FIRST_LOAD_BUDGET_BYTES)}`);
if (failures.length > 0) {
  console.error(`\n${failures.length} problem(s):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("Bundle budget met.");
