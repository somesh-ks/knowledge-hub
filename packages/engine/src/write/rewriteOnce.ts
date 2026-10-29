import { truncateAtParagraph } from "../extract/truncate.js";
import type { Linter, Violation, ViolationRule, VoiceField } from "../voice/lint.js";
import { numberValues } from "./spokenCheck.js";
import { trimToLimit } from "./trimToLimit.js";
import type { SourceMaterial, Writer } from "./types.js";

/** Rules whose `match` is a passage of the field, quoted back to the model as data. */
const FOCUS_RULES: ReadonlySet<ViolationRule> = new Set(["banned_pattern", "sentence_too_long"]);

/**
 * A voice rewrite fixes wording: the facts are already in the current text, so the source is there
 * to keep it honest, and its opening carries the facts a headline or summary states. About 25 of
 * these ran a briefing (2026-10-24), each resending up to 10k characters (D181).
 */
const REWRITE_SOURCE_CHARS = 4_000;

/** Every number the old text states is still stated, by value. */
function keepsNumbers(before: string, after: string): boolean {
  const kept = numberValues(after);
  for (const value of numberValues(before)) if (!kept.has(value)) return false;
  return true;
}

export interface RewriteOnceArgs {
  writer: Writer;
  linter: Linter;
  material: SourceMaterial;
  field: VoiceField;
  text: string;
  violations: readonly Violation[];
}

export interface RewriteOnceResult {
  text: string;
  /** Violations left after the rewrite. Empty means the field now passes. */
  violations: Violation[];
  rewritten: boolean;
}

/**
 * One rewrite for a field that failed lint, then lint again. A failing rewrite, or one that
 * fails lint again, is not retried: the caller drops the item and reports the remaining
 * violations. Budget errors propagate from the writer.
 */
export async function rewriteOnce(args: RewriteOnceArgs): Promise<RewriteOnceResult> {
  if (args.violations.length === 0) return { text: args.text, violations: [], rewritten: false };
  // Text matched by a banned pattern, and a sentence that runs too long, came from the source,
  // so they travel as delimited data.
  const focus = [
    ...new Set(
      args.violations
        .filter((v) => FOCUS_RULES.has(v.rule) && v.match !== undefined)
        .map((v) => (v.match as string).trim())
        .filter((match) => match.length > 0),
    ),
  ];
  const ask = (shorten: boolean): Promise<string | null> =>
    args.writer.rewrite({
      material: {
        ...args.material,
        text: truncateAtParagraph(args.material.text, REWRITE_SOURCE_CHARS).text,
      },
      field: args.field,
      current: args.text,
      problems: args.violations.map((v) => v.message),
      ...(focus.length > 0 ? { focus } : {}),
      ...(shorten ? { shorten } : {}),
    });
  // A headline over its word limit and nothing else needs a cut, not a new voice: the full rewrite
  // left 2 of 15 headlines at 14 words (2026-10-29). A shortening that fails, drops a number the
  // headline stated or still fails lint falls back to the full rewrite.
  const shorten =
    args.field === "headline" && args.violations.every((v) => v.rule === "too_many_words");
  let rewritten = await ask(shorten);
  if (shorten) {
    // The shortening is usable when it kept the numbers and passes lint, or a clause cut makes it pass.
    const usable =
      rewritten === null || !keepsNumbers(args.text, rewritten)
        ? null
        : args.linter.lint(args.field, rewritten).length === 0
          ? rewritten
          : trimToLimit(args.field, rewritten, args.linter);
    rewritten = usable ?? (await ask(false));
  }
  if (rewritten === null) {
    return { text: args.text, violations: [...args.violations], rewritten: false };
  }
  return { text: rewritten, violations: args.linter.lint(args.field, rewritten), rewritten: true };
}
