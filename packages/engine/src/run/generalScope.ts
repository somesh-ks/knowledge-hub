import {
  type DigestKind,
  effectiveSkipTopics,
  GENERAL_TOPICS,
  type Item,
  type JudgmentEntry,
  publishSection,
  type ScheduleFile,
  type Topic,
} from "@dispatch/core";
import { readJsonIfExists } from "../curate/inputs.js";
import type { RunMode } from "../gate/decideRun.js";
import { neutralEntry } from "../judge/topicOnly.js";
import { clamp01, round4 } from "../score/numbers.js";
import { type SourceFacts, storyFacts, topicScore } from "../score/scoreTopics.js";
import type { ScoredItem } from "../score/types.js";
import { GeneralJudgedFile, GeneralPoolFile } from "./generalNews.js";

/**
 * The general topics a pass publishes: those its podcast does not skip. The daily podcast counts
 * only in a scheduled run (an on-demand briefing covers what it always did), the weekly one in
 * every run mode. An empty list reads no general feed for the weekly pass.
 */
export function generalIdsFor(
  schedule: Pick<ScheduleFile, "skip_topics" | "weekly" | "general_scoped">,
  kind: DigestKind,
  mode: RunMode,
): string[] {
  if (kind === "weekly") {
    const skip = effectiveSkipTopics(schedule, "weekly");
    return GENERAL_TOPICS.map((t) => t.id).filter((id) => !skip.includes(id));
  }
  if (kind !== "regular" || mode !== "scheduled") return [];
  const skip = effectiveSkipTopics(schedule, "daily");
  return GENERAL_TOPICS.map((t) => t.id).filter((id) => !skip.includes(id));
}

/**
 * The pass's general stories as scored candidates for the topics it publishes (D66 judged them
 * already). A story scores as a coverage topic does: the topic's weight, the fit, the number of
 * outlets and the hype and sponsored discount; it takes the best of its topics and publishes in
 * that topic's section. Stories already in the pool, already shown (`seen`) or not judged are left
 * out. Nothing here asks the judge anything.
 */
export async function generalCandidates(input: {
  poolPath: string;
  judgedPath: string;
  topics: readonly Topic[];
  /** Source facts by id, for the topics' format mix and perspective. */
  sources?: Readonly<Record<string, SourceFacts>>;
  publish: readonly string[];
  inPool: ReadonlySet<string>;
  seen: Readonly<Record<string, unknown>>;
  now: Date;
  model: string;
}): Promise<ScoredItem[]> {
  if (input.publish.length === 0) return [];
  const pool = GeneralPoolFile.safeParse(await readJsonIfExists(input.poolPath, "general.json"));
  const judged = GeneralJudgedFile.safeParse(
    await readJsonIfExists(input.judgedPath, "general-judged.json"),
  );
  if (!pool.success || !judged.success) return [];
  const items = new Map(pool.data.items.map((item) => [item.id, item]));
  const topics = input.topics.filter((topic) => input.publish.includes(topic.id));
  const out: ScoredItem[] = [];
  for (const answer of judged.data.entries) {
    const item = items.get(answer.item_id);
    if (!item || input.inPool.has(item.id) || Object.hasOwn(input.seen, item.id)) continue;
    const entry = neutral(item, answer.flags, input);
    let best: { topic: Topic; fit: number; score: number; depth: number; penalty: number } | null =
      null;
    for (const topic of topics) {
      if (item.topic_ids?.includes(topic.id) !== true) continue;
      const fit = answer.fits[topic.id];
      const result = topicScore(
        topic,
        fit,
        entry,
        item,
        storyFacts(item, input.sources, pool.data.carriers[item.id]),
      );
      if (result === null || fit === undefined) continue;
      if (best === null || result.score > best.score) {
        best = { topic, fit, score: result.score, depth: result.depth, penalty: result.penalty };
      }
    }
    if (best === null) continue;
    out.push({
      item,
      entry,
      score: best.score,
      topCategory: "none",
      breakdown: {
        taste: round4(best.topic.weight),
        craftFactor: round4(clamp01(best.fit) ** 1.5 * best.depth),
        penaltyFactor: round4(best.penalty),
        bonus: 0,
      },
      topic: {
        id: best.topic.id,
        section_id: publishSection(best.topic),
        never_publish: false,
        fit: best.fit,
      },
    });
  }
  return out;
}

function neutral(
  item: Item,
  flags: { hype: number; sponsored: number } | undefined,
  input: { now: Date; model: string },
): JudgmentEntry {
  const base = neutralEntry(item, { model: input.model, questionsHash: "general", now: input.now });
  return {
    ...base,
    flags: { hype: flags?.hype ?? 0, sponsored: flags?.sponsored ?? 0, funding: 0 },
  };
}
