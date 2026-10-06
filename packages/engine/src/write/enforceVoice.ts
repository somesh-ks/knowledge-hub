import { type Linter, type Violation, VOICE_FIELDS } from "../voice/lint.js";
import { rewriteOnce } from "./rewriteOnce.js";
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
 * Lint every written field. A failing field gets one rewrite with the violations appended;
 * if it still fails, the item is dropped and its violations reported. Order is preserved.
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
      const violations = args.linter.lint(field, item[field]);
      const result = await rewriteOnce({
        writer: args.writer,
        linter: args.linter,
        material,
        field,
        text: item[field],
        violations,
      });
      item[field] = result.text;
      if (result.rewritten) rewrittenFields.push(field);
      remaining.push(...result.violations);
    }
    if (remaining.length === 0) passed.push({ item, rewrittenFields });
    else dropped.push({ id: item.id, violations: remaining });
  }
  return { passed, dropped };
}
