/**
 * Replays the briefing's story selection on a frozen pool and writes the episodes it would narrate,
 * for loop/eval.ts to score:
 *
 *   npx tsx loop/replay.ts <out dir>
 *
 * The pool (loop/fixtures/replay-2026-10/pool.json) is every story published in October 2026 with
 * its text as written and its judgment. Selection is the engine's own (scoreItem, selectItems and
 * the length sizing writeStage uses), so a change to those shows here. The writer is not run: each
 * story is read as it was written, so this measures selection, not the writer.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Digest,
  type DigestItem,
  type Item,
  isBuiltinCategory,
  type JudgmentEntry,
  parseDigestFile,
  serializeDigestFile,
  VOICE_LIMITS,
} from "../packages/core/src/index.js";
import { capForLength } from "../packages/engine/src/run/scheduleSize.js";
import { scoreItem } from "../packages/engine/src/score/scoreItem.js";
import { capFor, selectItems } from "../packages/engine/src/score/selectItems.js";
import type { ScoredItem } from "../packages/engine/src/score/types.js";

const ROOT = join(import.meta.dirname, "..");
const FIXTURE = join(import.meta.dirname, "fixtures", "replay-2026-10");

interface PoolEntry {
  item: DigestItem & { source_id?: string };
  judgment: JudgmentEntry | null;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

function asItem(story: DigestItem): Item {
  return {
    id: story.id,
    url: story.url,
    canonical_url: story.url,
    title: story.headline,
    source_id: story.source,
    source_type: story.source_type,
    ...(story.author ? { author: story.author } : {}),
    ...(story.published_at ? { published_at: story.published_at } : {}),
    fetched_at: story.published_at ?? "2026-10-15T00:00:00.000Z",
    snippet: story.summary,
    signals: {},
  } as Item;
}

function scored(pool: PoolEntry[], preferences: Parameters<typeof scoreItem>[1]): ScoredItem[] {
  return pool.map(({ item: story, judgment }) => {
    const item = asItem(story);
    if (judgment && isBuiltinCategory(story.category))
      return scoreItem(judgment, preferences, item);
    // A general or custom topic story: its topic and the score it was published with.
    return {
      item,
      entry: judgment ?? ({} as JudgmentEntry),
      score: story.score ?? 0,
      topCategory: "none",
      breakdown: { taste: 0, craftFactor: 0, penaltyFactor: 1, bonus: 0 },
      topic: { id: story.category, section_id: story.category, never_publish: false, fit: 1 },
    } as ScoredItem;
  });
}

function episode(
  kind: "regular" | "weekly",
  settings: { length_minutes: number; skip_topics: string[] },
  pool: PoolEntry[],
  base: Digest,
): string {
  const preferences = readJson<Parameters<typeof scoreItem>[1]>(
    join(ROOT, "loop", "fixtures", "preferences.json"),
  );
  const result = selectItems({
    scored: scored(pool, preferences),
    kind,
    floor: VOICE_LIMITS.items.floor,
    cap: capForLength(capFor(kind), VOICE_LIMITS.items.floor, settings.length_minutes),
    weights: preferences.weights,
    skipTopics: settings.skip_topics,
  });
  const byId = new Map(pool.map((entry) => [entry.item.id, entry.item]));
  const items = result.selected.map((chosen) => {
    const { first_digest: _first, ...story } = byId.get(chosen.item.id) as DigestItem & {
      first_digest?: string;
    };
    return { ...story, section: chosen.section };
  });
  const titles = { ...base.section_titles };
  for (const item of items) titles[item.section] ??= item.section;
  return serializeDigestFile({ ...base, items, section_titles: titles });
}

function main(): void {
  const out = process.argv[2];
  if (!out) throw new Error("usage: npx tsx loop/replay.ts <out dir>");
  // The engine judges no story for a topic that is off, so neither does the replay.
  const off = new Set(
    readJson<{ topics: { id: string; enabled: boolean }[] }>(
      join(ROOT, "loop", "fixtures", "topics.json"),
    )
      .topics.filter((topic) => !topic.enabled)
      .map((topic) => topic.id),
  );
  const pool = readJson<{ items: PoolEntry[] }>(join(FIXTURE, "pool.json")).items.filter(
    (entry) => !off.has(entry.item.category),
  );
  for (const [name, kind, digestFile] of [
    ["daily", "regular", "daily-2026-10-13"],
    ["weekly", "weekly", "weekly-2026-10-11"],
  ] as const) {
    const dir = join(out, `replay-${name}`);
    mkdirSync(dir, { recursive: true });
    const settingsFile = join(ROOT, "loop", "fixtures", digestFile, "settings.json");
    const settings = readJson<{ length_minutes: number; skip_topics: string[] }>(settingsFile);
    const base = parseDigestFile(
      readFileSync(join(ROOT, "loop", "fixtures", digestFile, "episode.md"), "utf8"),
    );
    copyFileSync(settingsFile, join(dir, "settings.json"));
    writeFileSync(join(dir, "episode.md"), episode(kind, settings, pool, base));
  }
}

main();
