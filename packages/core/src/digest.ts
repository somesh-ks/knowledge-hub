import { z } from "zod";
import { CategoryId, isBuiltinSection, SECTION_TITLES, SECTIONS, SectionId } from "./categories.js";
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
  /** A built-in section or one a custom topic defined; see `section_titles` on the digest. */
  section: SectionId,
  /** A built-in category or a custom topic id. */
  category: CategoryId,
  source_type: SourceType,
  headline: z.string().min(1),
  /**
   * A label of a few words for the player bar, where the headline would be cut off. Written since
   * 2026-10-18; the bar shows the headline for a story without one.
   */
  chapter: z.string().min(1).optional(),
  url: z.string().url(),
  source: z.string().min(1),
  author: z.string().optional(),
  summary: z.string().min(1),
  /**
   * The story as a host would tell it aloud. Narration only: the page never shows it. Digests
   * written before it existed have none, and narration then reads the headline and the summary.
   */
  spoken: z.string().min(1).optional(),
  /** Digests written before the four-beat voice carry a separate why line; newer ones do not. */
  why: z.string().min(1).optional(),
  score: z.number().min(0).max(1),
  published_at: isoDateTime.optional(),
});
export type DigestItem = z.infer<typeof DigestItem>;

/** The frontmatter of a digest file. The site renders from this; the Markdown body is generated. */
/** Regenerations one podcast takes (D212): the owner's count, with no limit per day. */
export const MAX_REGENERATIONS = 3;

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
  audio: z
    .object({
      url: z.string().url(),
      duration_ms: z.number().int().positive(),
      /** The same narration as Opus in MP4 (plan 19.1). Absent on an older record. */
      m4a_url: z.string().url().optional(),
    })
    .nullable(),
  cover: CoverSpec,
  /**
   * Titles of the sections the items sit in, in digest order, written when the digest is rendered.
   * Present only when a custom section is used. A digest therefore keeps its own headings after
   * the topic behind a section is renamed or removed. Absent means the built-in sections.
   */
  section_titles: z.record(SectionId, z.string().min(1).max(60)).optional(),
  /**
   * Stories the narration names after the opening, from their chapters: the structure's rundown
   * (D176), written when the digest is rendered so a later edit never changes its audio. Absent
   * means no rundown, as every briefing before the structure.
   */
  rundown: z.number().int().min(1).max(6).optional(),
  /**
   * How many times the owner has regenerated this podcast (D212). Written by the replacement run,
   * the old count plus one; absent means never. A podcast takes `MAX_REGENERATIONS`.
   */
  regenerations: z.number().int().min(1).max(MAX_REGENERATIONS).optional(),
  /** Weekly cap (18) plus the tech allowance and the allowances of custom sections. */
  items: z.array(DigestItem).min(3).max(48),
});
export type Digest = z.infer<typeof Digest>;

/**
 * Voice and size limits. Enforced by the validator and quoted in the writer prompt.
 *
 * A summary runs the four beats in three or four sentences. Two sentences are accepted so a thin
 * source is never padded. `whyWords` applies only to the why line of digests written before the
 * four-beat voice. The `spoken*` limits are for the host's telling of a story. `techCap` is the allowance for the Tech releases section, on top of `cap`.
 */
export const VOICE_LIMITS = {
  headlineWords: 12,
  /**
   * The player bar's chapter label (DigestItem.chapter). A 360px phone's bar holds 161px of title
   * beside the cover and two buttons, about 22 characters; the writer is asked for that, and a
   * label a few over is kept (cut by a letter or two on the narrowest phones).
   */
  chapterWords: 5,
  chapterChars: 22,
  summaryWords: 80,
  summarySentences: 4,
  summaryMinWords: 25,
  summaryMinSentences: 2,
  sentenceWords: 28,
  whyWords: 18,
  spokenWords: 95,
  spokenMinWords: 40,
  /** A hard ceiling in characters, so 24 stories can never outgrow the narration request. */
  spokenChars: 700,
  spokenSentences: 5,
  spokenMinSentences: 3,
  items: { floor: 3, target: [8, 12], cap: 12, weeklyCap: 18, techCap: 5, hardMax: 48 },
} as const;

export interface DigestSection {
  id: string;
  title: string;
}

/**
 * The sections of a digest in reading order, with their titles. The digest's own `section_titles`
 * come first and set the order, so a briefing written for a topic that was later renamed or
 * removed keeps its headings. The built-in table covers digests written before custom sections
 * existed (and any built-in section a snapshot omits). An unknown id with no snapshot is titled
 * by its id. Sections with no items are left out.
 */
export function digestSections(digest: Pick<Digest, "items" | "section_titles">): DigestSection[] {
  const used = new Set(digest.items.map((item) => item.section));
  const out: DigestSection[] = [];
  const seen = new Set<string>();
  const add = (id: string, title: string | undefined): void => {
    if (!used.has(id) || seen.has(id)) return;
    seen.add(id);
    out.push({ id, title: title ?? (isBuiltinSection(id) ? SECTION_TITLES[id] : id) });
  };
  for (const [id, title] of Object.entries(digest.section_titles ?? {})) add(id, title);
  for (const id of SECTIONS) add(id, undefined);
  for (const item of digest.items) add(item.section, undefined);
  return out;
}

/**
 * Newest first, the one order of briefings: the site's `/latest.json` and archive, `dispatch
 * status` and `singularity health` all use it. Same-day digests (a second run, a weekly) fall back to
 * when they were written; a regenerated briefing keeps its date, so it never jumps ahead.
 */
export function compareNewestFirst(
  a: Pick<Digest, "date" | "generated_at" | "id">,
  b: Pick<Digest, "date" | "generated_at" | "id">,
): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.generated_at !== b.generated_at) return a.generated_at < b.generated_at ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}
