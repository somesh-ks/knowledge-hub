import { VOICE_LIMITS } from "@singularity/core";
import type { Linter, VoiceField } from "../voice/lint.js";
import { countWords, splitSentences } from "../voice/sentences.js";

/** A headline cut at a clause break keeps at least this many words, or it no longer says the story. */
const HEADLINE_MIN_WORDS = 6;
const CLAUSE_BREAK = /[,;:]\s|\s[-–—]\s/g;

/** A headline cut where a clause ends, the longest cut inside the word limit. */
function headlinePrefix(text: string): string | null {
  let best: string | null = null;
  for (const match of text.matchAll(CLAUSE_BREAK)) {
    const prefix = text.slice(0, match.index).trim();
    const words = countWords(prefix);
    if (words >= HEADLINE_MIN_WORDS && words <= VOICE_LIMITS.headlineWords) best = prefix;
  }
  return best;
}

/**
 * Cut a headline or summary that runs past its limit down to it without a model call: a summary
 * loses its trailing sentences, a headline its trailing clause. The cut text is returned only if it
 * lints clean, so a story is never kept with a field the voice rules still refuse. The writer's
 * rewrite is for what a cut cannot fix (2026-10-29 dry run: 4 of 15 stories were lost to a fifth
 * sentence or a two-word-long headline, each after a rewrite that missed the limit again).
 */
export function trimToLimit(field: VoiceField, text: string, linter: Linter): string | null {
  let trimmed: string | null = null;
  if (field === "summary") {
    const sentences = splitSentences(text);
    if (sentences.length > VOICE_LIMITS.summarySentences) {
      trimmed = sentences.slice(0, VOICE_LIMITS.summarySentences).join(" ");
    }
  } else if (field === "headline" && countWords(text) > VOICE_LIMITS.headlineWords) {
    trimmed = headlinePrefix(text);
  }
  if (trimmed === null || linter.lint(field, trimmed).length > 0) return null;
  return trimmed;
}
