import { Category, JudgmentEntry, JudgmentsFile } from "@dispatch/core";
import { z } from "zod";
import { readJsonIfExists } from "../curate/inputs.js";
import { mergeJudgments } from "../judge/cache.js";
import { StageFailure } from "./errors.js";

const count = z.number().int().nonnegative();

/** `.cache/run/<id>/judged.json`: the judge's answers for one pass, read by the write stage. */
export const JudgedFile = z.object({
  version: z.literal(1),
  judge: z.object({ name: z.string(), model: z.string(), questions_hash: z.string() }),
  /** One entry per judged pool item, from the cache or a fresh call. */
  entries: z.array(JudgmentEntry),
  /** Pool items no judge could answer. They stay out of `seen` so the next run retries them. */
  unjudged: z.array(z.string()),
  counts: z.object({
    pool: count,
    cache_hits: count,
    fresh: count,
    unjudged: count,
    /** Entries answered by a judge other than the primary (Jev's fallback). */
    fallback: count,
  }),
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
      category: Category,
      text: z.string(),
    }),
  ),
});
export type MaterialsFile = z.infer<typeof MaterialsFile>;

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
