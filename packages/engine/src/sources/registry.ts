import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CONFIG_FILES,
  type Source,
  type SourcesFile,
  SourcesFile as SourcesSchema,
} from "@dispatch/core";
import { writeFileAtomic } from "../state/atomicWrite.js";

export class SourcesError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`config/sources.json is invalid: ${problems.slice(0, 5).join("; ")}`);
    this.name = "SourcesError";
    this.problems = problems;
  }
}

const ISSN = /^\d{4}-\d{3}[\dX]$/;
const REPO = /^[\w.-]+\/[\w.-]+$/;
const YOUTUBE_CHANNEL = /^UC[\w-]{22}$/;

/** Per-type requirements the schema cannot express. Disabled sources are not held to them. */
function problemsOf(source: Source): string[] {
  if (!source.enabled) return [];
  const where = `source ${source.id}`;
  switch (source.type) {
    case "rss":
      return source.feed_url ? [] : [`${where}: rss needs feed_url`];
    case "github":
      return source.options.repo && REPO.test(source.options.repo)
        ? []
        : [`${where}: github needs options.repo as owner/name`];
    case "youtube":
      return source.options.channel_id && YOUTUBE_CHANNEL.test(source.options.channel_id)
        ? []
        : [`${where}: youtube needs options.channel_id (UC plus 22 characters)`];
    case "crossref":
      return source.options.issn && ISSN.test(source.options.issn)
        ? []
        : [`${where}: crossref needs options.issn`];
    case "hn":
    case "arxiv":
    case "lobsters":
    case "producthunt":
    case "exa":
    case "firecrawl":
      return [];
    default: {
      const unreachable: never = source.type;
      return [`${where}: unknown type ${String(unreachable)}`];
    }
  }
}

/** Everything wrong with a parsed registry, as readable lines. Empty means valid. */
export function validateSources(file: SourcesFile): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const source of file.sources) {
    if (ids.has(source.id)) problems.push(`duplicate id ${source.id}`);
    ids.add(source.id);
    problems.push(...problemsOf(source));
  }
  return problems;
}

/** Parse and validate config/sources.json content. Throws SourcesError listing every problem. */
export function parseSources(json: unknown): SourcesFile {
  const parsed = SourcesSchema.safeParse(json);
  if (!parsed.success) {
    throw new SourcesError(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }
  const problems = validateSources(parsed.data);
  if (problems.length > 0) throw new SourcesError(problems);
  return parsed.data;
}

function sortedRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

/** Stable text for the file: schema key order per source, options sorted, trailing newline. */
export function serializeSources(file: SourcesFile): string {
  const ordered = {
    version: file.version,
    sources: file.sources.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      url: s.url,
      feed_url: s.feed_url,
      tier: s.tier,
      high_signal: s.high_signal,
      ...(s.category_hint ? { category_hint: s.category_hint } : {}),
      enabled: s.enabled,
      failures: s.failures,
      ...(s.last_ok ? { last_ok: s.last_ok } : {}),
      options: sortedRecord(s.options),
    })),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export async function loadSources(root: string): Promise<SourcesFile> {
  let text: string;
  try {
    text = await readFile(join(root, CONFIG_FILES.sources), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`${CONFIG_FILES.sources} not found. Run "dispatch sources import" first.`);
    }
    throw error;
  }
  return parseSources(JSON.parse(text) as unknown);
}

export async function saveSources(root: string, file: SourcesFile): Promise<void> {
  const checked = parseSources(file);
  await writeFileAtomic(join(root, CONFIG_FILES.sources), serializeSources(checked));
}
