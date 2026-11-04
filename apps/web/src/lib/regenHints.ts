/**
 * Which Regenerate controls a comment calls for (D337): the sheet opens on the comment alone, and
 * the Length and Categories controls appear as the typed words reach for them. A local match on the
 * words, never a model call, so each keystroke costs nothing; Jev reads the comment once the
 * typing pauses and can add what this misses (D370, lib/regenAsk.ts). Client-safe: no imports.
 */
export interface Hints {
  length: boolean;
  topics: boolean;
}

const LENGTH_CUES =
  /\b(?:\d+\s*(?:min|mins|minutes?)|minutes?|longer|shorter|short|long|brief|briefer|quick|quicker|concise|length|trim|detail|detailed|deeper)\b/i;
const TOPIC_CUES =
  /\b(?:topics?|categor(?:y|ies)|more on|less on|more about|less about|focus on|only|skip|drop|leave out|without|cover)\b/i;

/** The words of the category names that a comment can mention: the whole name, or a word of 5+ letters. */
function labelCues(labels: readonly string[]): RegExp | null {
  const words = labels.flatMap((label) => {
    const name = label.trim();
    return name ? [name, ...name.split(/\s+/).filter((word) => word.length >= 5)] : [];
  });
  if (words.length === 0) return null;
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(?:${escaped.join("|")})\\b`, "i");
}

/**
 * The controls the text calls for. `labels` are the category names on offer; with none, categories
 * are never called for. A control stays shown once it has appeared (the caller keeps it), so the
 * form does not shift under a person who edits their words.
 */
export function hintsFor(text: string, labels: readonly string[] = []): Hints {
  const mine = labelCues(labels);
  return {
    length: LENGTH_CUES.test(text),
    topics: mine !== null && (TOPIC_CUES.test(text) || mine.test(text)),
  };
}
