import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./staticServer.mjs";

/**
 * Builds the site for tests, then serves it. The build uses the invented fixture digests and skips
 * the Vercel adapter (DISPATCH_STATIC_ONLY), which bundles functions with symlinks that Windows
 * refuses without Developer Mode. The output is the same static site either way.
 *
 * Usage: node e2e/run.mjs [--build-only] [--serve-only]
 */

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const flags = new Set(process.argv.slice(2));
const port = Number(process.env.PORT ?? 4321);

if (!flags.has("--serve-only")) {
  const astroBin = join(
    dirname(createRequire(import.meta.url).resolve("astro/package.json")),
    "bin",
    "astro.mjs",
  );
  const build = spawnSync(process.execPath, [astroBin, "build"], {
    cwd: appRoot,
    stdio: "inherit",
    env: { ...process.env, SINGULARITY_FIXTURES: "1", SINGULARITY_STATIC_ONLY: "1" },
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

if (!flags.has("--build-only")) startServer({ root: join(appRoot, "dist"), port });
