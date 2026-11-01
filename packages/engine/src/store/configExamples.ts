import { copyFile, mkdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { CONFIG_DOCUMENT_PATHS } from "./configPaths.js";

/**
 * The public defaults for the owner's config (D296). The owner's own copy lives in the config store
 * and never in git, so a fresh checkout (a fork, CI, a build with the store off) starts from these.
 * Each example sits flat in this directory under the base name of the path it stands for.
 */
export const EXAMPLES_DIR = "config/examples";

/**
 * The documents a run cannot do without: with the store on, one missing after the copy stops the
 * command rather than leave the loaders on defaults the owner never chose (D296). The others have a
 * sound empty value (no added sources, no structure yet, the default writer, no suggestions).
 */
export const REQUIRED_CONFIG_DOCUMENTS: readonly string[] = [
  "config/preferences.json",
  "config/schedule.json",
  "config/topics.json",
];

/** Where the example for a store document is kept. */
export function examplePath(path: string): string {
  return join(EXAMPLES_DIR, basename(path));
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** The store documents that have no file in the checkout. */
export async function missingConfigFiles(root: string): Promise<string[]> {
  const missing: string[] = [];
  for (const path of CONFIG_DOCUMENT_PATHS) {
    if (!(await exists(join(root, path)))) missing.push(path);
  }
  return missing;
}

/** Copy the example over each missing file; a file that exists is never touched. Returns the paths filled. */
export async function copyMissingExamples(root: string): Promise<string[]> {
  const filled: string[] = [];
  for (const path of await missingConfigFiles(root)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await copyFile(join(root, examplePath(path)), join(root, path));
    filled.push(path);
  }
  return filled;
}
