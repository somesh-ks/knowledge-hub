/**
 * Pure helpers for model ids, shared by the build-time pages and the Model page's script. They
 * import nothing, so the browser bundle stays small. The id pattern is core's MODEL_ID_PATTERN
 * (packages/core/src/writer.ts); modelId.test.ts pins the two together.
 */
export const MODEL_ID_PATTERN = /^[A-Za-z0-9._\-/:]{1,120}$/;

export function isModelId(value: string): boolean {
  return MODEL_ID_PATTERN.test(value);
}

/** "meta-llama/Llama-3.3-70B-Instruct" gives name "Llama-3.3-70B-Instruct", vendor "meta-llama". */
export function modelParts(id: string): { name: string; vendor: string } {
  const cut = id.lastIndexOf("/");
  return cut < 0 ? { name: id, vendor: "" } : { name: id.slice(cut + 1), vendor: id.slice(0, cut) };
}

/** "128k context" for a window of 131072 tokens, or "" when it is not known. */
export function contextLabel(tokens: number | null | undefined): string {
  if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0) return "";
  return tokens >= 1024 ? `${Math.round(tokens / 1024)}k context` : `${tokens} tokens context`;
}
