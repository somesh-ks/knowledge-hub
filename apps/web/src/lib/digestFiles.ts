import { AudioTimeline, type Digest, parseDigestFile } from "@singularity/core";
import { type ContentFiles, diskFiles } from "./contentFiles";

export interface DigestSource {
  digest: Digest;
  timeline: AudioTimeline | null;
}

export interface DigestFiles {
  sources: DigestSource[];
  /** One line per file that was skipped, for the build log. */
  warnings: string[];
}

async function readTimeline(files: ContentFiles, file: string): Promise<AudioTimeline | null> {
  try {
    const text = await files.read(file);
    return text === null ? null : AudioTimeline.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * Reads every digest under `directory` (Digests/YYYY/MM/<id>.md and its <id>.audio.json). A missing
 * directory means no digests yet. A file that does not parse is skipped with a warning, so one bad
 * file never takes the whole site down, and it is never replaced by invented content.
 */
export async function readDigestFiles(
  directory: string,
  reader: ContentFiles = diskFiles,
): Promise<DigestFiles> {
  const files = await reader.list(directory);
  const sources: DigestSource[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const file of files.filter((name) => name.endsWith(".md"))) {
    try {
      const text = await reader.read(file);
      if (text === null) continue;
      const digest = parseDigestFile(text);
      if (seen.has(digest.id)) {
        warnings.push(`${file}: duplicate digest id ${digest.id}, skipped`);
        continue;
      }
      seen.add(digest.id);
      const timeline = await readTimeline(reader, file.replace(/\.md$/, ".audio.json"));
      // A timeline for a different digest would put the wrong chapters on this page.
      sources.push({ digest, timeline: timeline?.digest === digest.id ? timeline : null });
    } catch (error) {
      const reason = error instanceof Error ? error.message.split("\n")[0] : "unreadable";
      warnings.push(`${file}: ${reason}, skipped`);
    }
  }
  return { sources, warnings };
}
