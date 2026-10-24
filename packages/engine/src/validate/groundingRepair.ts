import { mapConcurrent } from "../llm/concurrency.js";
import type { Linter, Violation } from "../voice/lint.js";
import type { SourceMaterial, Writer, WrittenItem } from "../write/types.js";
import type { GroundedField, Grounder, GroundingVerdict, SentenceVerdict } from "./grounding.js";

export interface GroundedItem {
  item: WrittenItem;
  /** True only when every summary and why sentence was checked and supported. */
  verified: boolean;
  /** Fields rewritten once because a sentence was unsupported. */
  rewrittenFields: GroundedField[];
  checks: SentenceVerdict[];
}

export interface GroundingDrop {
  id: string;
  reason: "unsupported" | "voice";
  unsupported: SentenceVerdict[];
  violations: Violation[];
}

export interface GroundingOutcome {
  kept: GroundedItem[];
  dropped: GroundingDrop[];
  /** False when no grounder ran or any check could not complete: the digest is not "verified". */
  verified: boolean;
}

const CONCURRENCY = 4;

type StepResult = { keep: GroundedItem } | { drop: GroundingDrop };

function unsupportedOf(verdict: GroundingVerdict): SentenceVerdict[] {
  return verdict.sentences.filter((s) => s.status === "unsupported");
}

function hasError(verdict: GroundingVerdict): boolean {
  return verdict.sentences.some((s) => s.status === "error");
}

/**
 * Grounding stage. Each item's summary sentences, and its why sentence when it has one, are
 * checked against its source text.
 * Unsupported sentences trigger one rewrite of the affected fields with the sentences quoted
 * back as problems, then a second check; an item still unsupported (or whose rewrite breaks the
 * voice limits) is dropped and reported. Checks that error out keep the item but mark it
 * unverified, so an outage never silently passes as verified and never loses the whole run.
 * With no grounder every item is kept unverified.
 */
export async function groundAndRepair(args: {
  grounder: Grounder | null;
  writer: Writer;
  linter: Linter;
  items: readonly WrittenItem[];
  materials: ReadonlyMap<string, SourceMaterial>;
}): Promise<GroundingOutcome> {
  const { grounder, writer, linter } = args;
  if (grounder === null) {
    return {
      kept: args.items.map((item) => ({ item, verified: false, rewrittenFields: [], checks: [] })),
      dropped: [],
      verified: false,
    };
  }

  const results = await mapConcurrent(
    args.items,
    CONCURRENCY,
    async (original): Promise<StepResult> => {
      const material = args.materials.get(original.id);
      if (!material) {
        return {
          drop: { id: original.id, reason: "unsupported", unsupported: [], violations: [] },
        };
      }
      const check = (item: WrittenItem): Promise<GroundingVerdict> =>
        grounder.ground({
          id: item.id,
          summary: item.summary,
          ...(item.why ? { why: item.why } : {}),
          sourceText: material.text,
          heading: `${material.title} (${material.source})`,
        });

      let item = original;
      let verdict = await check(item);
      const rewrittenFields: GroundedField[] = [];

      const bad = unsupportedOf(verdict);
      if (bad.length > 0) {
        const fields = [...new Set(bad.map((s) => s.field))];
        const next: WrittenItem = { ...item };
        const violations: Violation[] = [];
        for (const field of fields) {
          const current = item[field];
          // A verdict only names a field the item has; this guard is for the type.
          if (current === undefined) continue;
          // The unsupported sentences are model text derived from the source, so they travel as
          // delimited `focus` data. The problem statement itself never embeds them.
          const rewritten = await writer.rewrite({
            material,
            field,
            current,
            problems: [
              "The checker found sentences in the current text that the source text does not support. Rewrite the field using only facts the source states; the passages below are the unsupported ones.",
            ],
            focus: bad.filter((s) => s.field === field).map((s) => s.sentence),
          });
          if (rewritten !== null) {
            next[field] = rewritten;
            rewrittenFields.push(field);
            violations.push(...linter.lint(field, rewritten));
          }
        }
        if (violations.length > 0) {
          return { drop: { id: item.id, reason: "voice", unsupported: bad, violations } };
        }
        // The spoken telling was written from the summary that was just rewritten, so it goes with it.
        if (rewrittenFields.includes("summary")) delete next.spoken;
        item = next;
        verdict = await check(item);
        const stillBad = unsupportedOf(verdict);
        if (stillBad.length > 0) {
          return {
            drop: { id: item.id, reason: "unsupported", unsupported: stillBad, violations: [] },
          };
        }
      }

      const verified = !hasError(verdict);
      return { keep: { item, verified, rewrittenFields, checks: verdict.sentences } };
    },
  );

  const kept: GroundedItem[] = [];
  const dropped: GroundingDrop[] = [];
  for (const result of results) {
    if ("keep" in result) kept.push(result.keep);
    else dropped.push(result.drop);
  }
  return { kept, dropped, verified: kept.length > 0 && kept.every((k) => k.verified) };
}
