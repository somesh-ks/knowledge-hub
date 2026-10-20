import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CONFIG_FILES,
  type Preferences,
  resolveTopics,
  type TopicsFile,
  TopicsFile as TopicsSchema,
} from "@dispatch/core";
import { writeFileAtomic } from "../state/atomicWrite.js";

export class TopicsError extends Error {
  constructor(problems: string[]) {
    super(`${CONFIG_FILES.topics} is invalid: ${problems.slice(0, 5).join("; ")}`);
    this.name = "TopicsError";
  }
}

/** config/topics.json as written, or null when it does not exist yet. */
export async function loadTopicsFile(root: string): Promise<TopicsFile | null> {
  let text: string;
  try {
    text = await readFile(join(root, CONFIG_FILES.topics), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new TopicsError(["not valid JSON"]);
  }
  const parsed = TopicsSchema.safeParse(json);
  if (!parsed.success) {
    throw new TopicsError(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }
  return parsed.data;
}

/**
 * The topics a run works from: the file (or the seed, when it is missing) with built-in weights
 * taken from the preferences. With no custom topic in it, scoring behaves exactly as it did
 * before topics existed.
 */
export async function loadTopics(
  root: string,
  preferences: Pick<Preferences, "weights">,
): Promise<TopicsFile> {
  return resolveTopics(await loadTopicsFile(root), preferences);
}

/** Stable text for the file: fields in schema order, two-space indent, trailing newline. */
export function serializeTopics(file: TopicsFile): string {
  const ordered = {
    version: file.version,
    sections: file.sections.map((s) => ({ id: s.id, title: s.title, order: s.order })),
    topics: file.topics.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      weight: t.weight,
      enabled: t.enabled,
      keywords: t.keywords,
      section_id: t.section_id,
      never_publish: t.never_publish,
      origin: t.origin,
      depth: t.depth,
      ...(t.format_mix ? { format_mix: t.format_mix } : {}),
      ...(t.perspective ? { perspective: t.perspective } : {}),
    })),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export async function saveTopics(root: string, file: TopicsFile): Promise<void> {
  const checked = TopicsSchema.parse(file);
  await writeFileAtomic(join(root, CONFIG_FILES.topics), serializeTopics(checked));
}
