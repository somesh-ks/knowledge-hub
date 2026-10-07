import { z } from "zod";
import { type Category, CategoryOrNone } from "./categories.js";

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

export const LastRunFile = z.object({
  version: z.literal(1),
  regular: RunRecord.optional(),
  weekly: RunRecord.optional(),
  on_demand: RunRecord.optional(),
  /** End of the most recent successful fetch of any kind. Start of the next window. */
  last_fetch_at: isoDateTime.optional(),
  /** Most recent cover, so the next one can avoid repeating it. */
  last_cover: z.object({ template: z.string(), palette: z.string() }).optional(),
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

export const EMPTY_SEEN: SeenFile = { version: 1, items: {} };
export const EMPTY_JUDGMENTS: JudgmentsFile = { version: 1, entries: {} };
export const EMPTY_LAST_RUN: LastRunFile = { version: 1 };

export type { Category };
