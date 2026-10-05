import { LlmOutputError } from "./errors.js";

const THINK_BLOCK = /<think>[\s\S]*?<\/think>/gi;
const FENCE = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;

/** First balanced {...} or [...] slice, skipping braces inside strings. */
function firstJsonSlice(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start < 0) return null;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/**
 * Parse a model reply as JSON. Tolerates inline reasoning blocks and code fences, which some
 * models emit even when asked for bare JSON. Throws LlmOutputError when nothing parses.
 */
export function parseModelJson(raw: string): unknown {
  const text = raw.replace(THINK_BLOCK, "").trim();
  const candidates = [text, FENCE.exec(text)?.[1], firstJsonSlice(text)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }
  throw new LlmOutputError("The model reply was not valid JSON.");
}
