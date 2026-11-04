/**
 * Fills Digests/ and Podcasts/ before the site is built (D300). They are in the content store, not
 * in git, and the build bundles them as the fallback the pages read when the store is slow. With
 * the store's token set and the store unreachable the build stops, so the last good deployment stays
 * up rather than a site with no digests replacing it. The fixture build, and a build without the
 * token (a fork, a laptop), keep whatever Digests/ holds.
 */
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try {
  // The engine reads .env itself, but this check runs first. A variable already set wins over the file.
  process.loadEnvFile(join(root, ".env"));
} catch {
  // No .env, or one that cannot be read: the environment alone supplies the keys.
}
const env = process.env;
const fixtures = env.SINGULARITY_FIXTURES === "1" || env.DISPATCH_FIXTURES === "1";
const hasStore =
  Boolean(env.BLOB_READ_WRITE_TOKEN) || Boolean(env.VERCEL_OIDC_TOKEN && env.BLOB_STORE_ID);
if (fixtures || !hasStore) {
  process.stdout.write(
    `content: not pulled (${fixtures ? "fixture build" : "no Blob credentials"})\n`,
  );
  process.exit(0);
}
const pulled = spawnSync(
  "npm",
  ["run", "--silent", "singularity", "--", "content", "pull", "--root", root],
  { cwd: root, env: process.env, stdio: "inherit", shell: process.platform === "win32" },
);
process.exit(pulled.status ?? 1);
