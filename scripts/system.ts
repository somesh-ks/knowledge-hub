/**
 * Writes the design system file (packages/design-system/tokens/system.json and llms.txt) with the
 * apps that draw the system: the reader, and the command center, which imports its sheets. The
 * package builds its catalogue without them (D382 step 4c); this passes in where they style and
 * write each part. Run: npm run system. `--check` fails when either file is stale.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type SystemInput, writeSystem } from "@singularity/design-system/scripts/system/build";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const APPS = {
  root: ROOT,
  styles: [join(ROOT, "apps/web/src/styles")],
  sources: [join(ROOT, "apps/web/src"), join(ROOT, "apps/admin/src")],
  bespoke: join(ROOT, "apps/web/src/styles/styles.test.ts"),
} satisfies SystemInput;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeSystem(APPS, process.argv.includes("--check"));
}
