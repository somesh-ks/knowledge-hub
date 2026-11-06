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
   * The narration voice the schedule gave this kind when the digest was rendered (D296). The audio
   * job holds no config store access (SEC-03), so the run that has it writes the voice here. Absent
   * means the run's own voice, as every digest before.
   */
  voice_id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .optional(),
  /**
   * How many times the owner has regenerated this podcast (D212). Written by the replacement run,
   * the old count plus one; absent means never. A podcast takes `MAX_REGENERATIONS`.
   */
  regenerations: z.number().int().min(1).max(MAX_REGENERATIONS).optional(),
  /** Weekly cap (18) plus the tech allowance and the allowances of custom sections. */
  items: z.array(DigestItem).min(3).max(48),
});
export type Digest = z.infer<typeof Digest>;

// Moved to voiceLimits.ts, which the browser can load without zod (D377).
export { VOICE_LIMITS } from "./voiceLimits.js";

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
 * Newest first, the one order of briefings: the site's `/latest.json` and archive, `singularity
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
