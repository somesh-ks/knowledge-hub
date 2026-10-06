import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { AudioTimeline, type Digest, parseDigestFile } from "@dispatch/core";

export interface DigestSource {
  digest: Digest;
  timeline: AudioTimeline | null;
}

export interface DigestFiles {
  sources: DigestSource[];
  /** One line per file that was skipped, for the build log. */
  warnings: string[];
}

async function listFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readTimeline(file: string): Promise<AudioTimeline | null> {
  try {
    return AudioTimeline.parse(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return null;
  }
}

/**
 * Reads every digest under `directory` (Digests/YYYY/MM/<id>.md and its <id>.audio.json). A missing
 * directory means no digests yet. A file that does not parse is skipped with a warning, so one bad
 * file never takes the whole site down, and it is never replaced by invented content.
 */
export async function readDigestFiles(directory: string): Promise<DigestFiles> {
  const files = await listFiles(directory);
  const sources: DigestSource[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const file of files.filter((name) => name.endsWith(".md"))) {
    try {
      const digest = parseDigestFile(await readFile(file, "utf8"));
      if (seen.has(digest.id)) {
        warnings.push(`${file}: duplicate digest id ${digest.id}, skipped`);
        continue;
      }
      seen.add(digest.id);
      const timeline = await readTimeline(file.replace(/\.md$/, ".audio.json"));
      // A timeline for a different digest would put the wrong chapters on this page.
      sources.push({ digest, timeline: timeline?.digest === digest.id ? timeline : null });
    } catch (error) {
      const reason = error instanceof Error ? error.message.split("\n")[0] : "unreadable";
      warnings.push(`${file}: ${reason}, skipped`);
    }
  }
  return { sources, warnings };
}
