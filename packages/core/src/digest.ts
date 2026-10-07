import { z } from "zod";
import { Category, Section } from "./categories.js";
import { SourceType } from "./item.js";

const isoDateTime = z.string().datetime({ offset: true });

export const DIGEST_KINDS = ["regular", "weekly", "on-demand"] as const;
export const DigestKind = z.enum(DIGEST_KINDS);
export type DigestKind = z.infer<typeof DigestKind>;

/** Date, optionally followed by `-weekly` or a same-day sequence number (`-2`, `-3`). */
export const DigestId = z.string().regex(/^\d{4}-\d{2}-\d{2}(-weekly|-[2-9]|-[1-9]\d+)?$/);
export type DigestId = z.infer<typeof DigestId>;

export const COVER_TEMPLATES = [
  "spring",
  "dither",
  "contour",
  "numeral",
  "lattice",
  "orbit",
  "aperture",
  "band",
] as const;
export const CoverSpec = z.object({
  template: z.enum(COVER_TEMPLATES),
  /** Palette id from tokens/covers.json. */
  palette: z.string().min(1),
  seed: z.number().int().nonnegative(),
});
export type CoverSpec = z.infer<typeof CoverSpec>;

export const DigestItem = z.object({
  id: z.string().regex(/^[0-9a-f]{12}$/),
  section: Section,
  category: Category,
  source_type: SourceType,
  headline: z.string().min(1),
  url: z.string().url(),
  source: z.string().min(1),
  author: z.string().optional(),
  summary: z.string().min(1),
  /** Digests written before the four-beat voice carry a separate why line; newer ones do not. */
  why: z.string().min(1).optional(),
  score: z.number().min(0).max(1),
  published_at: isoDateTime.optional(),
});
export type DigestItem = z.infer<typeof DigestItem>;

/** The frontmatter of a digest file. The site renders from this; the Markdown body is generated. */
export const Digest = z.object({
  id: DigestId,
  /** Stockholm calendar date, YYYY-MM-DD. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: DigestKind,
  /** False when the grounding check did not run (agent mode). */
  verified: z.boolean(),
  generated_at: isoDateTime,
  window: z.object({ from: isoDateTime, to: isoDateTime }),
  read_minutes: z.number().int().positive(),
  listen_minutes: z.number().int().positive(),
  audio: z.object({ url: z.string().url(), duration_ms: z.number().int().positive() }).nullable(),
  cover: CoverSpec,
  /** Weekly cap (18) plus the tech allowance (5), with one to spare. */
  items: z.array(DigestItem).min(3).max(24),
});
export type Digest = z.infer<typeof Digest>;

/**
 * Voice and size limits. Enforced by the validator and quoted in the writer prompt.
 *
 * A summary runs the four beats in three or four sentences. Two sentences are accepted so a thin
 * source is never padded. `whyWords` applies only to the why line of digests written before the
 * four-beat voice. `techCap` is the allowance for the Tech releases section, on top of `cap`.
 */
export const VOICE_LIMITS = {
  headlineWords: 12,
  summaryWords: 80,
  summarySentences: 4,
  summaryMinWords: 25,
  summaryMinSentences: 2,
  sentenceWords: 28,
  whyWords: 18,
  items: { floor: 3, target: [8, 12], cap: 12, weeklyCap: 18, techCap: 5 },
} as const;
