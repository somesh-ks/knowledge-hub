import { z } from "zod";
import { SectionId } from "./categories.js";
import { DigestId } from "./digest.js";

/** Item and section start times inside one digest's MP3. Stored as Digests/YYYY/MM/<id>.audio.json. */
export const AudioTimeline = z.object({
  digest: DigestId,
  voice: z.string().min(1),
  model: z.string().min(1),
  /** "marks" when derived from word-level speech marks, "estimated" from character share. */
  timeline: z.enum(["marks", "estimated"]),
  duration_ms: z.number().int().positive(),
  text_chars: z.number().int().positive(),
  items: z.array(
    z.object({
      id: z.string().regex(/^[0-9a-f]{12}$/),
      section: SectionId,
      start_ms: z.number().int().nonnegative(),
      end_ms: z.number().int().positive(),
    }),
  ),
  sections: z.array(z.object({ slug: SectionId, start_ms: z.number().int().nonnegative() })),
});
export type AudioTimeline = z.infer<typeof AudioTimeline>;
