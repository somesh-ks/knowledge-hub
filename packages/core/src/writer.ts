import { z } from "zod";

/** Providers the writer can run on. */
export const WRITER_PROVIDERS = ["nebius", "anthropic"] as const;
export type WriterProvider = (typeof WRITER_PROVIDERS)[number];

/** A Nebius model id: letters, digits and `. _ - / :`, 1 to 120 characters. */
export const MODEL_ID_PATTERN = /^[A-Za-z0-9._\-/:]{1,120}$/;
export const ModelId = z.string().regex(MODEL_ID_PATTERN, "not a valid model id");

/** An Anthropic model id: `claude-` then letters, digits and `-`. */
export const ANTHROPIC_MODEL_ID_PATTERN = /^claude-[A-Za-z0-9-]{1,100}$/;

/**
 * The Anthropic models Settings offers when Anthropic's live list cannot be read. Any well-formed
 * claude- id passes here, so the engine can run a model released after this list; the site's
 * /api/config refuses one Anthropic does not list (D117).
 */
export const ANTHROPIC_MODELS = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", hint: "Best prose and judgment" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", hint: "Fastest and cheapest" },
] as const;

export function isAnthropicModel(id: string): boolean {
  return ANTHROPIC_MODELS.some((model) => model.id === id);
}

/** Why a provider and model pair is refused, or null when it is allowed. */
export function writerModelProblem(provider: string, model: string | null): string | null {
  if (provider === "anthropic") {
    if (model === null) return "choose a Claude model";
    if (!ANTHROPIC_MODEL_ID_PATTERN.test(model)) return "not an Anthropic model id";
    return null;
  }
  if (model !== null && model.startsWith("claude-"))
    return "a claude- id needs the Anthropic provider";
  return null;
}

/**
 * Shape of config/writer.json. `model` is null for "use the engine's own setting" (the
 * DISPATCH_MODEL environment variable).
 */
const WriterFileShape = z.object({
  version: z.literal(1),
  provider: z.enum(WRITER_PROVIDERS),
  model: ModelId.nullable(),
});
const checkPair = (value: { provider: string; model: string | null }, ctx: z.RefinementCtx) => {
  const problem = writerModelProblem(value.provider, value.model);
  if (problem) ctx.addIssue({ code: "custom", path: ["model"], message: problem });
};
export const WriterFile = WriterFileShape.superRefine(checkPair);
export type WriterFile = z.infer<typeof WriterFile>;

/** What a repository without config/writer.json runs on: Claude Sonnet 5.5 (owner, 2026-10-14). */
export const DEFAULT_WRITER: WriterFile = {
  version: 1,
  provider: "anthropic",
  model: "claude-sonnet-5-5",
};

/** The values `writer.set` and the settings page send; the version is the file's own. */
export const WriterSettingsShape = WriterFileShape.omit({ version: true });
export const WriterSettings = WriterSettingsShape.superRefine(checkPair);
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
