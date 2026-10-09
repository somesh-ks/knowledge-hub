import { z } from "zod";

/** Providers the writer can run on. One value today; a second is one more entry. */
export const WRITER_PROVIDERS = ["nebius"] as const;
export type WriterProvider = (typeof WRITER_PROVIDERS)[number];

/** A Nebius model id: letters, digits and `. _ - / :`, 1 to 120 characters. */
export const MODEL_ID_PATTERN = /^[A-Za-z0-9._\-/:]{1,120}$/;
export const ModelId = z.string().regex(MODEL_ID_PATTERN, "not a valid model id");

/**
 * Shape of config/writer.json. `model` is null for "use the engine's own setting" (the
 * DISPATCH_MODEL environment variable).
 */
export const WriterFile = z.object({
  version: z.literal(1),
  provider: z.enum(WRITER_PROVIDERS),
  model: ModelId.nullable(),
});
export type WriterFile = z.infer<typeof WriterFile>;

/** What a repository without config/writer.json runs on. */
export const DEFAULT_WRITER: WriterFile = { version: 1, provider: "nebius", model: null };

/** The values `writer.set` and the settings page send; the version is the file's own. */
export const WriterSettings = WriterFile.omit({ version: true });
export type WriterSettings = z.infer<typeof WriterSettings>;

/**
 * The models a run tries, in order and without duplicates: the one chosen in Settings, then
 * DISPATCH_MODEL, then DISPATCH_FALLBACK_MODEL. Empty values are dropped.
 */
export function resolveWriterModels(
  configModel: string | null | undefined,
  env: { DISPATCH_MODEL?: string | undefined; DISPATCH_FALLBACK_MODEL?: string | undefined },
): string[] {
  const seen = new Set<string>();
  for (const candidate of [configModel, env.DISPATCH_MODEL, env.DISPATCH_FALLBACK_MODEL]) {
    const id = candidate?.trim();
    if (id) seen.add(id);
  }
  return [...seen];
}
