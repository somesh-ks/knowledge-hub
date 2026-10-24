import {
  Category,
  CategoryId,
  JudgmentEntry,
  JudgmentsFile,
  TopicJudgmentsFile,
} from "@singularity/core";
import { z } from "zod";
import { readJsonIfExists } from "../curate/inputs.js";
import { mergeJudgments } from "../judge/cache.js";
import { mergeTopicJudgments } from "../judge/topicJudge.js";
import { StageFailure } from "./errors.js";

const count = z.number().int().nonnegative();

/** `.cache/run/<id>/judged.json`: the judge's answers for one pass, read by the write stage. */
export const JudgedFile = z.object({
  version: z.literal(1),
  judge: z.object({ name: z.string(), model: z.string(), questions_hash: z.string() }),
  /** One entry per judged pool item, from the cache or a fresh call. */
  entries: z.array(JudgmentEntry),
  /** Pool items no judge could answer. The next run that fetches them retries the judge. */
  unjudged: z.array(z.string()),
  counts: z.object({
    pool: count,
    cache_hits: count,
    fresh: count,
    unjudged: count,
    /** Entries answered by a judge other than the primary (Jev's fallback). */
    fallback: count,
  }),
  /**
   * Fit of each item to the custom topics it was judged for: item id to topic id to 0..1. Absent
   * when there are no custom topics, so a run without them writes the same file as before.
   */
  topic_fits: z.record(z.string(), z.record(z.string(), z.number().min(0).max(1))).optional(),
  /**
   * Pool items that stand in with a neutral judgment because a coverage topic decides them alone
   * (judge/topicOnly.ts): they were not asked the main questions, the hype and sponsored flags
   * among them, so they do not count toward a source's trust. Absent when there are none.
   */
  neutral_ids: z.array(z.string()).optional(),
});
export type JudgedFile = z.infer<typeof JudgedFile>;

/** `.cache/run/<id>/materials.json`: the source text each written item came from, for grounding. */
export const MaterialsFile = z.object({
  version: z.literal(1),
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      source: z.string(),
      author: z.string().optional(),
      /** The writer is told the nearest built-in category, even for a custom topic. */
      category: Category,
      text: z.string(),
      /** The owner's prompt for the story's block (D182), so a later rewrite keeps to it. */
      prompt: z.string().optional(),
    }),
  ),
});
export type MaterialsFile = z.infer<typeof MaterialsFile>;

/**
 * `reserve.json`: the stories a length-sized pass would select next, best first, none of them
 * written. Validation writes replacements from it, once, when grounding cuts the briefing short.
 */
export const ReserveFile = z.object({
  version: z.literal(1),
  /** What the owner asked to improve, for the writer prompt of the replacements. */
  feedback: z.string().optional(),
  /** The vote headlines the write stage told the writer, so replacements share its moment. */
  taste: z
    .object({ liked: z.array(z.string()), disliked: z.array(z.string()) })
    .default({ liked: [], disliked: [] }),
  /** Set once validation has written replacements, so a re-run of validate refills no more. */
  refilled: z.boolean().optional(),
  items: z.array(
    z.object({
      id: z.string(),
      /** A built-in category or a custom topic's id, as the selection stores it. */
      category: CategoryId,
      score: z.number().min(0).max(1),
      /** The built-in category the writer prompt is told. */
      writer_category: Category,
      /** The section it would air in, for its block's prompt (D182); older files have none. */
      section: z.string().optional(),
    }),
  ),
});
export type ReserveFile = z.infer<typeof ReserveFile>;

/** Read a JSON artifact and validate it, or fail with the file's name. */
export async function readArtifact<T>(
  path: string,
  label: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const raw = await readJsonIfExists(path, label);
  if (raw === null) throw new StageFailure(`${label} is missing. Run the earlier stages first.`);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new StageFailure(
      `${label} is invalid (${parsed.error.issues[0]?.message ?? "bad shape"}). Run the earlier stages again.`,
    );
  }
  return parsed.data;
}

/** Add the entries a run cache holds to a cache. An unreadable run cache is ignored: it only saves calls. */
export async function withRunJudgments(
  base: JudgmentsFile,
  runCachePath: string,
): Promise<JudgmentsFile> {
  try {
    const parsed = JudgmentsFile.safeParse(await readJsonIfExists(runCachePath, "judgments.json"));
    return parsed.success ? mergeJudgments(base, Object.values(parsed.data.entries)) : base;
  } catch {
    return base;
  }
}

/** Add the topic fits a run cache holds to a cache. An unreadable run cache is ignored. */
export async function withRunTopicJudgments(
  base: TopicJudgmentsFile,
  runCachePath: string,
): Promise<TopicJudgmentsFile> {
  try {
    const parsed = TopicJudgmentsFile.safeParse(
      await readJsonIfExists(runCachePath, "topic-judgments.json"),
    );
    return parsed.success ? mergeTopicJudgments(base, Object.values(parsed.data.entries)) : base;
  } catch {
    return base;
  }
}
