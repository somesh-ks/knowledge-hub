import type { Linter, Violation, VoiceField } from "../voice/lint.js";
import type { SourceMaterial, Writer } from "./types.js";

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
  const rewritten = await args.writer.rewrite({
    material: args.material,
    field: args.field,
    current: args.text,
    problems: args.violations.map((v) => v.message),
  });
  if (rewritten === null) {
    return { text: args.text, violations: [...args.violations], rewritten: false };
  }
  return { text: rewritten, violations: args.linter.lint(args.field, rewritten), rewritten: true };
}
