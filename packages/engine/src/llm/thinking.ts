/**
 * How to switch a model's thinking off. The parameter differs by model on Nebius, so this is
 * data, not code: the default is the documented `reasoning_effort: "none"`.
 */
export type ThinkingOff =
  | { kind: "reasoning_effort"; value: "none" | "minimal" | "low" }
  /** Extra request fields, for models that use a template flag such as chat_template_kwargs. */
  | { kind: "extra_body"; body: Record<string, unknown> }
  /** Send nothing, for models that do not think. */
  | { kind: "omit" };

export const DEFAULT_THINKING_OFF: ThinkingOff = { kind: "reasoning_effort", value: "none" };

/** Request fields that implement a ThinkingOff choice. Exhaustive over the union. */
export function thinkingParams(thinking: ThinkingOff): Record<string, unknown> {
  switch (thinking.kind) {
    case "reasoning_effort":
      return { reasoning_effort: thinking.value };
    case "extra_body":
      return { ...thinking.body };
    case "omit":
      return {};
    default: {
      const unreachable: never = thinking;
      throw new Error(`Unhandled thinking mode: ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * Parse a short spec, for example from a config value:
 * `reasoning_effort:none`, `reasoning_effort:minimal`, `omit`, or `extra:{"chat_template_kwargs":{"enable_thinking":false}}`.
 * An empty value gives the default.
 */
export function parseThinkingOff(spec: string | undefined): ThinkingOff {
  const text = spec?.trim();
  if (!text) return DEFAULT_THINKING_OFF;
  if (text === "omit") return { kind: "omit" };
  if (text.startsWith("reasoning_effort:")) {
    const value = text.slice("reasoning_effort:".length);
    if (value === "none" || value === "minimal" || value === "low") {
      return { kind: "reasoning_effort", value };
    }
    throw new Error(`Unsupported reasoning_effort "${value}". Use none, minimal or low.`);
  }
  if (text.startsWith("extra:")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.slice("extra:".length));
    } catch {
      throw new Error("The extra: thinking spec must be a JSON object.");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("The extra: thinking spec must be a JSON object.");
    }
    return { kind: "extra_body", body: parsed as Record<string, unknown> };
  }
  throw new Error(
    `Unrecognized thinking spec "${text}". Use reasoning_effort:none, extra:{...} or omit.`,
  );
}
