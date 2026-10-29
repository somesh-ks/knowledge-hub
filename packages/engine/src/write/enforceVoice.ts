import { mapConcurrent } from "../llm/concurrency.js";
import { type Linter, type Violation, VOICE_FIELDS } from "../voice/lint.js";
import { rewriteOnce } from "./rewriteOnce.js";
import { spokenIsGrounded, ungroundedNumbers } from "./spokenCheck.js";
import { trimToLimit } from "./trimToLimit.js";
import type { SourceMaterial, Writer, WrittenItem } from "./types.js";

/** Stories voice-checked at once; the writer's own batches run four at a time too. */
const VOICE_CONCURRENCY = 4;

export interface VoicePassed {
  item: WrittenItem;
  /** Fields that needed their one rewrite. */
  rewrittenFields: string[];
}

export interface VoiceDropped {
  id: string;
  violations: Violation[];
}

export interface VoiceOutcome {
  passed: VoicePassed[];
  dropped: VoiceDropped[];
}

/**
 * Lint every written field an item has. A failing field gets one rewrite with the violations appended;
 * if it still fails, the item is dropped and its violations reported. Order is preserved.
 *
 * The spoken version is different: it is an extra. A spoken text that fails lint, or states a number
 * the headline and summary do not, gets one rewrite; if it still fails it is removed from the item
 * and narration falls back to the headline and the summary. It never costs the item.
 * Items without source material are dropped with no violations. Writer and linter errors,
 * including writer budget errors, propagate to the caller.
 */
export async function enforceVoice(args: {
  written: readonly WrittenItem[];
  materials: ReadonlyMap<string, SourceMaterial>;
  writer: Writer;
  linter: Linter;
}): Promise<VoiceOutcome> {
  // Stories are independent, and a rewrite is a model call of several seconds: one at a time, a
  // briefing with 25 of them (2026-10-24) waited on each in turn. Results keep the order of `written`.
  const results = await mapConcurrent(
    args.written,
    VOICE_CONCURRENCY,
    async (original): Promise<{ passed: VoicePassed } | { dropped: VoiceDropped }> => {
      const material = args.materials.get(original.id);
      if (!material) return { dropped: { id: original.id, violations: [] } };
      const item: WrittenItem = { ...original };
      const rewrittenFields: string[] = [];
      const remaining: Violation[] = [];
      for (const field of VOICE_FIELDS) {
        if (field === "spoken") continue;
        const text = item[field];
        // The writer produces no why line, so there is usually nothing to lint for that field.
        if (text === undefined) continue;
        const violations = args.linter.lint(field, text);
        // A fifth sentence or a headline a few words long is cut, not rewritten: a cut costs no model
        // call and cannot miss the limit again, as a rewrite did for 4 of 15 stories (2026-10-29).
        const cut = violations.length > 0 ? trimToLimit(field, text, args.linter) : null;
        if (cut !== null) {
          item[field] = cut;
          continue;
        }
        const result = await rewriteOnce({
          writer: args.writer,
          linter: args.linter,
          material,
          field,
          text,
          violations,
        });
        const recut =
          result.violations.length > 0 ? trimToLimit(field, result.text, args.linter) : null;
        item[field] = recut ?? result.text;
        if (result.rewritten) rewrittenFields.push(field);
        if (recut === null) remaining.push(...result.violations);
      }
      if (remaining.length > 0) return { dropped: { id: item.id, violations: remaining } };
      if (item.spoken !== undefined) {
        // An invented-looking number gets the same one rewrite as a lint failure: dropping the
        // spoken text makes narration read the headline and then a summary that restates it.
        const invented = ungroundedNumbers(item.spoken, item.headline, item.summary);
        const result = await rewriteOnce({
          writer: args.writer,
          linter: args.linter,
          material,
          field: "spoken",
          text: item.spoken,
          violations: [
            ...args.linter.lint("spoken", item.spoken),
            ...(invented.length > 0
              ? [
                  {
                    field: "spoken" as const,
                    rule: "ungrounded_number" as const,
                    message: `State only numbers the headline or summary state; ${invented.join(", ")} is in neither. Remove it or use the summary's figure.`,
                  },
                ]
              : []),
          ],
        });
        // Judged after the rewrite, because a rewrite is where an invented number would come from.
        if (
          result.violations.length === 0 &&
          spokenIsGrounded(result.text, item.headline, item.summary)
        ) {
          item.spoken = result.text;
          if (result.rewritten) rewrittenFields.push("spoken");
        } else {
          delete item.spoken;
        }
      }
      return { passed: { item, rewrittenFields } };
    },
  );
  const passed: VoicePassed[] = [];
  const dropped: VoiceDropped[] = [];
  for (const result of results) {
    if ("passed" in result) passed.push(result.passed);
    else dropped.push(result.dropped);
  }
  return { passed, dropped };
}
