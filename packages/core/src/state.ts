import { z } from "zod";
import { type Category, CategoryOrNone, IdString } from "./categories.js";

const isoDateTime = z.string().datetime({ offset: true });
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Item ids already shown, mapped to the date they were shown or judged. Pruned at 90 days. */
export const SeenFile = z.object({
  version: z.literal(1),
  items: z.record(z.string(), ymd),
});
export type SeenFile = z.infer<typeof SeenFile>;

const unit = z.number().min(0).max(1);

/**
 * Probability per category, including "none". Sums to about 1. An entry cached before a category
 * existed has no key for it; the missing key reads as 0, so an older state/judgments.json still
 * parses and is rewritten with the full set of keys.
 */
const CategoryProbs = z.preprocess(
  (value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
    const filled: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    for (const key of CategoryOrNone.options) if (!Object.hasOwn(filled, key)) filled[key] = 0;
    return filled;
  },
  z.record(CategoryOrNone, unit),
);

export const JudgmentEntry = z.object({
  item_id: z.string(),
  model: z.string(),
  questions_hash: z.string(),
  judged_at: isoDateTime,
  category_probs: CategoryProbs,
  /** Normalized craft depth, 0 to 1. */
  craft_depth: unit,
  /**
   * Normalized launch scale, 0 to 1. Ranks consumer tech items in place of craft depth. Absent
   * from entries judged before the question existed, where it counts as 0.
   */
  launch_scale: unit.optional(),
  flags: z.object({
    hype: z.number().min(0).max(1),
    sponsored: z.number().min(0).max(1),
    funding: z.number().min(0).max(1),
  }),
});
export type JudgmentEntry = z.infer<typeof JudgmentEntry>;

/** Cached judge answers keyed `${item_id}:${questions_hash}:${model}`. Pruned at 30 days. */
export const JudgmentsFile = z.object({
  version: z.literal(1),
  entries: z.record(z.string(), JudgmentEntry),
});
export type JudgmentsFile = z.infer<typeof JudgmentsFile>;

export const OUTCOMES = ["published", "gated", "nothing", "failed"] as const;
export const Outcome = z.enum(OUTCOMES);
export type Outcome = z.infer<typeof Outcome>;

export const RunRecord = z.object({
  at: isoDateTime,
  outcome: Outcome,
  digest_id: z.string().optional(),
  items: z.number().int().nonnegative().default(0),
});
export type RunRecord = z.infer<typeof RunRecord>;

/** Paid requests one run made, by service, written by the commit stage. */
export const RunSpend = z.object({
  at: isoDateTime,
  /** Request counts by service: jev, nebius, exa, firecrawl_listing, firecrawl_scrape. */
  requests: z.record(z.string(), z.number().int().nonnegative()),
  /** 429 replies from Firecrawl; three stop it for the rest of the run. */
  firecrawl_rate_limited: z.number().int().nonnegative().default(0),
  /** Firecrawl listing sources left out of the run for the ceiling. */
  firecrawl_skipped: z.array(z.string()).default([]),
});
export type RunSpend = z.infer<typeof RunSpend>;

export const LastRunFile = z.object({
  version: z.literal(1),
  regular: RunRecord.optional(),
  weekly: RunRecord.optional(),
  on_demand: RunRecord.optional(),
  /** End of the most recent successful fetch of any kind. Start of the next window. */
  last_fetch_at: isoDateTime.optional(),
  /** Most recent cover, so the next one can avoid repeating it. */
  last_cover: z.object({ template: z.string(), palette: z.string() }).optional(),
  /** What the most recent run spent on paid services. */
  spend: RunSpend.optional(),
});
export type LastRunFile = z.infer<typeof LastRunFile>;

export const UsageFile = z.object({
  version: z.literal(1),
  speechify: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), characters: z.number().int() }),
});
export type UsageFile = z.infer<typeof UsageFile>;

/**
 * Per-source fetch health, kept apart from config/sources.json so a run never rewrites
 * hand-edited configuration. Overlaid onto the registry when it is loaded.
 */
export const SourceHealthFile = z.object({
  version: z.literal(1),
  sources: z.record(
    z.string(),
    z.object({
      failures: z.number().int().nonnegative(),
      last_ok: isoDateTime.optional(),
    }),
  ),
});
export type SourceHealthFile = z.infer<typeof SourceHealthFile>;
export const EMPTY_SOURCE_HEALTH: SourceHealthFile = { version: 1, sources: {} };

/**
 * One custom-topic fit answer. The cache key names the topic and a hash of its name and
 * description, so editing one topic asks the judge about that topic again and nothing else.
 */
export const TopicJudgmentEntry = z.object({
  item_id: z.string(),
  topic_id: IdString,
  /** Hash of the topic's name, description and the question wording. */
  topic_hash: z.string(),
  model: z.string(),
  judged_at: isoDateTime,
  /** Normalized fit, 0 (unrelated) to 1 (squarely on the topic). */
  fit: unit,
});
export type TopicJudgmentEntry = z.infer<typeof TopicJudgmentEntry>;

/** Cached fit answers keyed `${item_id}:${topic_id}:${topic_hash}:${model}`. Pruned at 30 days. */
export const TopicJudgmentsFile = z.object({
  version: z.literal(1),
  entries: z.record(z.string(), TopicJudgmentEntry),
});
export type TopicJudgmentsFile = z.infer<typeof TopicJudgmentsFile>;
export const EMPTY_TOPIC_JUDGMENTS: TopicJudgmentsFile = { version: 1, entries: {} };

/**
 * Counters for one source over a rolling 30-day window. `fetched` items entered a pool, `judged`
 * were answered by a judge, `passed` cleared the score bar, `published` reached a digest. When the
 * window is older than 30 days the counters are halved and the window restarts, so a source's
 * recent record outweighs its history without a per-day log.
 */
export const SourceStat = z.object({
  fetched: z.number().int().nonnegative(),
  judged: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  published: z.number().int().nonnegative(),
  /** Stockholm calendar date the current window began. */
  window_start: ymd,
});
export type SourceStat = z.infer<typeof SourceStat>;

export const SourceStatsFile = z.object({
  version: z.literal(1),
  sources: z.record(z.string(), SourceStat),
});
export type SourceStatsFile = z.infer<typeof SourceStatsFile>;
export const EMPTY_SOURCE_STATS: SourceStatsFile = { version: 1, sources: {} };

const quality = z.number().min(0).max(1);

/** One feed `dispatch sources suggest` looked at, kept so the app can show why it did or did not make the cut. */
export const SourceCandidate = z.object({
  /** Source id the entry would get. */
  id: z.string(),
  name: z.string(),
  /** Human-facing page. */
  url: z.string().url(),
  feed_url: z.string().url().nullable(),
  /** Null when the feed failed validation, so no score was computed. */
  q: quality.nullable(),
  parts: z
    .object({
      fit: quality,
      pass_rate: quality,
      freshness: quality,
      reliability: quality,
      prior: quality,
    })
    .nullable(),
  /** Entries in the feed, and how many were published in the last 30 days. */
  entries: z.number().int().nonnegative(),
  recent_entries: z.number().int().nonnegative(),
  /**
   * "suggested" cleared the quality bar and is offered to the owner; discovery adds nothing by
   * itself (D40). "added" only appears in files written before that: the source was added then.
   */
  status: z.enum(["suggested", "added", "below_bar", "not_top", "rejected"]),
  /** Why a candidate was rejected or skipped, in one sentence. */
  reason: z.string().optional(),
});
export type SourceCandidate = z.infer<typeof SourceCandidate>;

export const SourceCandidatesFile = z.object({
  version: z.literal(1),
  topics: z.record(
    z.string(),
    z.object({
      suggested_at: isoDateTime,
      queries: z.array(z.string()),
      candidates: z.array(SourceCandidate),
    }),
  ),
});
export type SourceCandidatesFile = z.infer<typeof SourceCandidatesFile>;
export const EMPTY_SOURCE_CANDIDATES: SourceCandidatesFile = { version: 1, topics: {} };

export const EMPTY_SEEN: SeenFile = { version: 1, items: {} };
export const EMPTY_JUDGMENTS: JudgmentsFile = { version: 1, entries: {} };
export const EMPTY_LAST_RUN: LastRunFile = { version: 1 };

export type { Category };
