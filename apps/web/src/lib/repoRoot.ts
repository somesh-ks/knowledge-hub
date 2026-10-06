import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * The Dispatch repository root. `DISPATCH_REPO_ROOT` wins (astro.config.mjs sets it); otherwise walk
 * up from `startDir` until the core package appears. No git call, so it works in a Vercel build.
 */
export function findRepoRoot(
  startDir: string = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): string {
  const fromEnv = env.DISPATCH_REPO_ROOT;
  if (fromEnv) return resolve(fromEnv);
  let directory = resolve(startDir);
  for (;;) {
    if (existsSync(join(directory, "packages", "core", "package.json"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`Could not find the repository root above ${startDir}`);
    }
    directory = parent;
  }
}
