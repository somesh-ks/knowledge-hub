import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CONFIG_FILES,
  DigestId,
  DigestKind,
  EMPTY_JUDGMENTS,
  EMPTY_LAST_RUN,
  Item,
  JudgmentsFile,
  LastRunFile,
  Preferences,
  type Source,
  SourcesFile,
  STATE_FILES,
} from "@dispatch/core";
import { z } from "zod";

/** Read and parse a JSON file. Null when it does not exist; any other failure throws a clear error. */
export async function readJsonIfExists(path: string, label: string): Promise<unknown | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`Could not read ${label}.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

export async function loadPreferences(root: string): Promise<Preferences> {
  const raw = await readJsonIfExists(
    join(root, CONFIG_FILES.preferences),
    CONFIG_FILES.preferences,
  );
  if (raw === null) throw new Error(`${CONFIG_FILES.preferences} is missing.`);
  const parsed = Preferences.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `${CONFIG_FILES.preferences} is invalid: ${parsed.error.issues[0]?.message ?? "bad shape"}.`,
    );
  }
  return parsed.data;
}

/** The source registry, or an empty list when config/sources.json does not exist yet. */
export async function loadSources(root: string): Promise<Source[]> {
  const raw = await readJsonIfExists(join(root, CONFIG_FILES.sources), CONFIG_FILES.sources);
  if (raw === null) return [];
  const parsed = SourcesFile.safeParse(raw);
  if (!parsed.success) throw new Error(`${CONFIG_FILES.sources} is invalid.`);
  return parsed.data.sources;
}

export async function loadJudgments(root: string): Promise<JudgmentsFile> {
  const raw = await readJsonIfExists(join(root, STATE_FILES.judgments), STATE_FILES.judgments);
  if (raw === null) return EMPTY_JUDGMENTS;
  const parsed = JudgmentsFile.safeParse(raw);
  // A cache is disposable: an unreadable one is rebuilt rather than failing the run.
  return parsed.success ? parsed.data : EMPTY_JUDGMENTS;
}

export async function loadLastRun(root: string): Promise<LastRunFile> {
  const raw = await readJsonIfExists(join(root, STATE_FILES.lastRun), STATE_FILES.lastRun);
  if (raw === null) return EMPTY_LAST_RUN;
  const parsed = LastRunFile.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_LAST_RUN;
}

export function sourceNameMap(sources: readonly Source[]): Record<string, string> {
  return Object.fromEntries(sources.map((s) => [s.id, s.name]));
}

/** Ids of sources whose items link to other publishers (the "newsletter-link" kind). */
export function linkSourceIds(sources: readonly Source[]): Set<string> {
  return new Set(sources.filter((s) => s.options.kind === "newsletter-link").map((s) => s.id));
}

export interface PoolMeta {
  /** Digest id the pool was gathered for, which is also its run directory name. */
  id?: string;
  kind?: DigestKind;
  window?: { from: string; to: string };
}

export interface ParsedPool {
  items: Item[];
  /** Entries that did not match the Item schema and were skipped. */
  invalid: number;
  /** What `dispatch fetch` recorded about the run, when the pool is its `{ version, id, ... }` file. */
  meta: PoolMeta;
}

const isoDateTime = z.string().datetime({ offset: true });

// Each field is read on its own, so one bad field does not discard the others.
const PoolHeader = z.object({
  id: DigestId.optional().catch(undefined),
  kind: DigestKind.optional().catch(undefined),
  window: z.object({ from: isoDateTime, to: isoDateTime }).optional().catch(undefined),
});

function metaOf(header: z.infer<typeof PoolHeader>): PoolMeta {
  const meta: PoolMeta = {};
  if (header.id !== undefined) meta.id = header.id;
  if (header.kind !== undefined) meta.kind = header.kind;
  if (header.window !== undefined) meta.window = header.window;
  return meta;
}

/** Accepts a bare array of items or an object holding them under `items` or `pool`. */
export function parsePool(raw: unknown): ParsedPool {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === "object" && raw !== null
      ? (((raw as { items?: unknown; pool?: unknown }).items as unknown[] | undefined) ??
        ((raw as { pool?: unknown }).pool as unknown[] | undefined) ??
        [])
      : [];
  const items: Item[] = [];
  let invalid = 0;
  for (const entry of Array.isArray(list) ? list : []) {
    const parsed = Item.safeParse(entry);
    if (parsed.success) items.push(parsed.data);
    else invalid += 1;
  }
  const header = Array.isArray(raw) ? null : PoolHeader.safeParse(raw);
  return { items, invalid, meta: header?.success ? metaOf(header.data) : {} };
}

export async function loadPool(path: string): Promise<ParsedPool> {
  const raw = await readJsonIfExists(path, "the pool file");
  if (raw === null)
    throw new Error(`The pool file does not exist: ${path}. Run \`dispatch fetch\` first.`);
  return parsePool(raw);
}
