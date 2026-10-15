import { type Linter, type Violation, VOICE_FIELDS } from "../voice/lint.js";
import { rewriteOnce } from "./rewriteOnce.js";
import { spokenIsGrounded, ungroundedNumbers } from "./spokenCheck.js";
import type { SourceMaterial, Writer, WrittenItem } from "./types.js";

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
 */
export async function enforceVoice(args: {
  written: readonly WrittenItem[];
  materials: ReadonlyMap<string, SourceMaterial>;
  writer: Writer;
  linter: Linter;
}): Promise<VoiceOutcome> {
  const passed: VoicePassed[] = [];
  const dropped: VoiceDropped[] = [];
  for (const original of args.written) {
    const material = args.materials.get(original.id);
    if (!material) {
      dropped.push({ id: original.id, violations: [] });
      continue;
    }
    const item: WrittenItem = { ...original };
    const rewrittenFields: string[] = [];
    const remaining: Violation[] = [];
    for (const field of VOICE_FIELDS) {
      if (field === "spoken") continue;
      const text = item[field];
      // The writer produces no why line, so there is usually nothing to lint for that field.
      if (text === undefined) continue;
      const violations = args.linter.lint(field, text);
      const result = await rewriteOnce({
        writer: args.writer,
        linter: args.linter,
        material,
        field,
        text,
        violations,
      });
      item[field] = result.text;
      if (result.rewritten) rewrittenFields.push(field);
      remaining.push(...result.violations);
    }
    if (remaining.length === 0) {
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
      passed.push({ item, rewrittenFields });
    } else dropped.push({ id: item.id, violations: remaining });
  }
  return { passed, dropped };
}
