/**
 * Fills Digests/ and Podcasts/ before the site is built (D300). They are in the content store, not
 * in git, and the build bundles them as the fallback the pages read when the store is slow. With
 * the store's token set and the store unreachable the build stops, so the last good deployment stays
 * up rather than a site with no digests replacing it. The fixture build, and a build without the
 * token (a fork, a laptop), keep whatever Digests/ holds.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = process.env.SINGULARITY_FIXTURES === "1" || process.env.DISPATCH_FIXTURES === "1";
if (fixtures || !process.env.BLOB_READ_WRITE_TOKEN) {
  process.stdout.write(
    `content: not pulled (${fixtures ? "fixture build" : "BLOB_READ_WRITE_TOKEN is not set"})\n`,
  );
  process.exit(0);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pulled = spawnSync(
  "npm",
  ["run", "--silent", "singularity", "--", "content", "pull", "--root", root],
  { cwd: root, env: process.env, stdio: "inherit", shell: process.platform === "win32" },
);
process.exit(pulled.status ?? 1);
