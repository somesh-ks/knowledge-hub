/**
 * Pure helpers for model ids, shared by the build-time pages and the model select's script. They
 * import nothing, so the browser bundle stays small. The id pattern is core's MODEL_ID_PATTERN
 * (packages/core/src/writer.ts); writer.test.ts pins the two together.
 */
export const MODEL_ID_PATTERN = /^[A-Za-z0-9._\-/:]{1,120}$/;

export function isModelId(value: string): boolean {
  return MODEL_ID_PATTERN.test(value);
}

/**
 * The Anthropic models Settings offers. Core's ANTHROPIC_MODELS is the source; writer.test.ts pins
 * the two together.
 */
export const CLAUDE_MODELS: ReadonlyArray<{ id: string; label: string; hint: string }> = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", hint: "Strongest, slowest and dearest" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", hint: "Best prose and judgment" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", hint: "Fastest and cheapest" },
];

/**
 * The Nebius models Settings offers by name, as its Top models, best writer first. Each id is the
 * routing key of a public endpoint on tokenfactory.nebius.com/endpoints, and the order is EQ-Bench's
 * longform writing score, the nearest public measure of a script, both checked on 2026-10-21. Kimi
 * models are never offered, by the owner's word on 2026-10-21 (EXCLUDED_MODELS in modelRank.ts). A
 * weekly scheduled check proposes a refresh of this list. Nebius retires models (Qwen3-32B left on
 * 2026-08-31, D24), so the page drops an id the live list no longer has (topModels in
 * modelRank.ts), and a pick that fails at run time falls through to the environment's model (D46).
 */
export const NEBIUS_TOP: ReadonlyArray<{ id: string; label: string }> = [
  { id: "zai-org/GLM-5.3", label: "GLM-5.3" },
  { id: "zai-org/GLM-5.2", label: "GLM-5.2" },
  { id: "deepseek-ai/DeepSeek-V4-Pro-0813", label: "DeepSeek V4 Pro 0813" },
  { id: "deepseek-ai/DeepSeek-V4.1-Flash", label: "DeepSeek V4.1 Flash" },
  { id: "zai-org/GLM-5.1", label: "GLM-5.1" },
];

/**
 * The model Nebius runs on when Settings names none (the engine's DISPATCH_MODEL, GLM-5.3 by the
 * owner's word on 2026-10-14). The page shows it, and picking Nebius starts on it.
 */
export const NEBIUS_DEFAULT_ID = "zai-org/GLM-5.3";

/** The vendor an id belongs to: Claude ids start with "claude-", every other id is Nebius's. */
export function providerOf(id: string): "anthropic" | "nebius" {
  return id.startsWith("claude-") ? "anthropic" : "nebius";
}

/** "meta-llama/Llama-3.3-70B-Instruct" gives name "Llama-3.3-70B-Instruct", vendor "meta-llama". */
export function modelParts(id: string): { name: string; vendor: string } {
  const cut = id.lastIndexOf("/");
  return cut < 0 ? { name: id, vendor: "" } : { name: id.slice(cut + 1), vendor: id.slice(0, cut) };
}

/** What a Nebius model is called on the page: its Top models name, or the id's last segment. */
export function nebiusName(id: string): string {
  return NEBIUS_TOP.find((model) => model.id === id)?.label ?? modelParts(id).name;
}
