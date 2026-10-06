import type { Item } from "@dispatch/core";
import { STATE_LIMITS } from "./questions.js";

/** What a judge sees of an item. Title and snippet only, never fetched page text. */
export interface JudgeState {
  title: string;
  source: string;
  author: string | null;
  snippet: string;
  signals: Record<string, number>;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const TAGS = /<[^>]*>/g;
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/** Plain, single-spaced text capped at `max` characters on a word boundary. */
export function cleanText(text: string, max: number): string {
  const plain = text
    .replace(CONTROL_CHARS, " ")
    .replace(TAGS, " ")
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

export function judgeState(item: Item): JudgeState {
  const signals: Record<string, number> = {};
  for (const [key, value] of Object.entries(item.signals)) {
    if (typeof value === "number") signals[key] = value;
  }
  return {
    title: cleanText(item.title, STATE_LIMITS.titleChars),
    source: item.source_id,
    author: item.author ? cleanText(item.author, 120) : null,
    snippet: cleanText(item.snippet, STATE_LIMITS.snippetChars),
    signals,
  };
}
