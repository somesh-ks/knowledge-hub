import { AudioTimeline, type Digest, parseDigestFile } from "@singularity/core";
import { type ContentFiles, diskFiles, mapLimit, READ_CONCURRENCY } from "./contentFiles";

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

  // Read side by side (the store answers each file separately), judged in file order.
  const read = await mapLimit(
    files.filter((name) => name.endsWith(".md")),
    READ_CONCURRENCY,
    async (file) => {
      try {
        const text = await reader.read(file);
        if (text === null) return { file, found: false as const };
        const digest = parseDigestFile(text);
        return { file, found: true as const, digest };
      } catch (error) {
        const reason = error instanceof Error ? error.message.split("\n")[0] : "unreadable";
        return { file, found: false as const, reason };
      }
    },
  );
  const accepted: { file: string; digest: Digest }[] = [];
  for (const result of read) {
    if (!result.found) {
      if ("reason" in result) warnings.push(`${result.file}: ${result.reason}, skipped`);
      continue;
    }
    const { file, digest } = result;
    if (seen.has(digest.id)) {
      warnings.push(`${file}: duplicate digest id ${digest.id}, skipped`);
      continue;
    }
    seen.add(digest.id);
    accepted.push({ file, digest });
  }
  // Timelines only for the digests kept: a skipped copy's read must not count as a failed read of the store.
  const timelines = await mapLimit(accepted, READ_CONCURRENCY, ({ file }) =>
    readTimeline(reader, file.replace(/\.md$/, ".audio.json")),
  );
  accepted.forEach(({ digest }, index) => {
    const timeline = timelines[index] ?? null;
    // A timeline for a different digest would put the wrong chapters on this page.
    sources.push({ digest, timeline: timeline?.digest === digest.id ? timeline : null });
  });
  return { sources, warnings };
}
