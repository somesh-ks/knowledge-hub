import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./staticServer.mjs";

/**
 * Builds the site for tests, then serves it. The build uses the invented fixture digests and skips
 * the Vercel adapter (SINGULARITY_STATIC_ONLY), which bundles functions with symlinks that Windows
 * refuses without Developer Mode. The output is the same static site either way.
 *
 * Usage: node e2e/run.mjs [--build-only] [--serve-only]
 */

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const adminRoot = join(appRoot, "..", "admin");
const flags = new Set(process.argv.slice(2));
const port = Number(process.env.PORT ?? 4321);

if (!flags.has("--serve-only")) {
  const astroBin = join(
    dirname(createRequire(import.meta.url).resolve("astro/package.json")),
    "bin",
    "astro.mjs",
  );
  // The owner's config is not in git (D296), and the config route bundles those files: fill what a
  // clean checkout lacks from config/examples. The fixture env keeps it off the config store.
  const tsx = createRequire(import.meta.url).resolve("tsx/cli");
  const pulled = spawnSync(
    process.execPath,
    [tsx, join(appRoot, "..", "..", "scripts", "pullConfig.ts")],
    {
      stdio: "inherit",
      env: { ...process.env, SINGULARITY_FIXTURES: "1" },
    },
  );
  if (pulled.status !== 0) process.exit(pulled.status ?? 1);
  // The reader, then the admin app, which the reader's rewrite serves at /admin.
  for (const cwd of [appRoot, adminRoot]) {
    const build = spawnSync(process.execPath, [astroBin, "build"], {
      cwd,
      stdio: "inherit",
      env: { ...process.env, SINGULARITY_FIXTURES: "1", SINGULARITY_STATIC_ONLY: "1" },
    });
    if (build.status !== 0) process.exit(build.status ?? 1);
  }
}

if (!flags.has("--build-only")) {
  startServer({
    root: join(appRoot, "dist"),
    port,
    mounts: { "/admin": join(adminRoot, "dist") },
  });
}
