/**
 * Fills config/ before the site is built (D296). The owner's config is in the config store, not in
 * git, so a build asks `singularity config pull` for it: the stored documents with the store on,
 * config/examples otherwise. With the store on and unreachable the build stops, so the last good
 * deployment stays up rather than a site made from defaults replacing it. The fixture build takes
 * the examples and never asks the store.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = process.env.SINGULARITY_FIXTURES === "1" || process.env.DISPATCH_FIXTURES === "1";
// The fixture build (CI, the browser suites) reads apps/web/src/fixtures for its pages, but the
// config route still bundles the repository's config files, so they must exist: the examples fill
// them, and the store is never asked.
const env = { ...process.env };
if (fixtures) {
  // Empty, not deleted: a deleted variable would come back from a local .env.
  env.SINGULARITY_CONFIG_STORE = "";
  env.DISPATCH_CONFIG_STORE = "";
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pulled = spawnSync(
  "npm",
  ["run", "--silent", "singularity", "--", "config", "pull", ...(fixtures ? [] : ["--strict"])],
  {
    cwd: root,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);
process.exit(pulled.status ?? 1);
