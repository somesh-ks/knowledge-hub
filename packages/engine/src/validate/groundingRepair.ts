import { mapConcurrent } from "../llm/concurrency.js";
import type { Linter, Violation } from "../voice/lint.js";
import { splitSentences } from "../voice/sentences.js";
import { rewriteOnce } from "../write/rewriteOnce.js";
import type { SourceMaterial, Writer, WrittenItem } from "../write/types.js";
import type { GroundedField, Grounder, GroundingVerdict, SentenceVerdict } from "./grounding.js";

export interface GroundedItem {
  item: WrittenItem;
  /** True only when every summary and why sentence was checked and supported. */
  verified: boolean;
  /** Fields rewritten once because a sentence was unsupported. */
  rewrittenFields: GroundedField[];
  checks: SentenceVerdict[];
  /** Unsupported sentences cut out, which left a text that still passes the voice limits. */
  prunedSentences: number;
}

export interface GroundingDrop {
  id: string;
  reason: "unsupported" | "voice";
  unsupported: SentenceVerdict[];
  violations: Violation[];
  /** Fields rewritten before the drop: the repair attempts made. */
  repairs: number;
}

export interface GroundingOutcome {
  kept: GroundedItem[];
  dropped: GroundingDrop[];
  /** False when no grounder ran or any check could not complete: the digest is not "verified". */
  verified: boolean;
}

/**
 * Stories grounded at once, and the sentences of one story checked at once. Each story is
 * independent, so the stories overlap; the two numbers multiply into the Jev requests in flight (32,
 * as when it was four stories of eight sentences), and a story has about five sentences, so four at
 * once costs it little.
 */
const CONCURRENCY = 8;
export const GROUNDING_SENTENCE_CONCURRENCY = 4;

type StepResult = { keep: GroundedItem } | { drop: GroundingDrop };

function unsupportedOf(verdict: GroundingVerdict): SentenceVerdict[] {
  return verdict.sentences.filter((s) => s.status === "unsupported");
}

function hasError(verdict: GroundingVerdict): boolean {
  return verdict.sentences.some((s) => s.status === "error");
}

/**
 * What an item reads like with its unsupported sentences cut out, or null when that leaves a text
 * that breaks the voice limits (fewer than two sentences, under the minimum words): then there is
 * nothing honest left to say and the item is dropped. A sentence whose check errored stays: only a
 * sentence the checker found unsupported goes. A why line left with no sentence is removed.
 */
function prune(
  item: WrittenItem,
  verdict: GroundingVerdict,
  linter: Linter,
): { item: WrittenItem; fields: GroundedField[]; removed: number } | null {
  const next: WrittenItem = { ...item };
  const fields: GroundedField[] = [];
  let removed = 0;
  for (const field of ["summary", "why"] as const) {
    const current = item[field];
    if (current === undefined) continue;
    const cut = new Set(
      verdict.sentences
        .filter((s) => s.field === field && s.status === "unsupported")
        .map((s) => s.sentence),
    );
    if (cut.size === 0) continue;
    const kept = splitSentences(current).filter((sentence) => !cut.has(sentence));
    removed += splitSentences(current).length - kept.length;
    fields.push(field);
    if (field === "why" && kept.length === 0) {
      delete next.why;
      continue;
    }
    const text = kept.join(" ");
    if (linter.lint(field, text).length > 0) return null;
    next[field] = text;
  }
  // The spoken telling was written from the summary that was just cut, so it goes with it.
  if (fields.includes("summary")) delete next.spoken;
  return { item: next, fields, removed };
}

/**
 * Grounding stage. Each item's summary sentences, and its why sentence when it has one, are
 * checked against its source text.
 * An unsupported sentence is first cut out when what is left still passes the voice limits: a story
 * with two true sentences beats no story, and it costs no model call. Otherwise the affected fields
 * get one rewrite with the sentences quoted back as problems; a rewrite that breaks the voice
 * limits gets one more, with the violations as problems (2026-10-27: three of four drops were a
 * 30-word sentence or an 88-word summary in a grounding rewrite). The rewritten item is checked
 * again, and the sentences still unsupported are cut the same way before an item is dropped and
 * reported. Checks that error out keep the item but mark it unverified, so an outage never
 * silently passes as verified and never loses the whole run. With no grounder every item is kept
 * unverified.
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
      kept: args.items.map((item) => ({
        item,
        verified: false,
        rewrittenFields: [],
        checks: [],
        prunedSentences: 0,
      })),
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
          drop: {
            id: original.id,
            reason: "unsupported",
            unsupported: [],
            violations: [],
            repairs: 0,
          },
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
      let prunedSentences = 0;

      const bad = unsupportedOf(verdict);
      if (bad.length > 0) {
        // Cut first: it keeps only sentences the checker already supported.
        const pruned = prune(item, verdict, linter);
        if (pruned !== null) {
          const remaining = verdict.sentences.filter((s) => s.status !== "unsupported");
          return {
            keep: {
              item: pruned.item,
              verified: !hasError({ id: item.id, sentences: remaining }),
              rewrittenFields: pruned.fields,
              checks: remaining,
              prunedSentences: pruned.removed,
            },
          };
        }
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
          if (rewritten === null) continue;
          rewrittenFields.push(field);
          // A rewrite that fixed the facts but broke a length rule gets its one voice rewrite.
          const repaired = await rewriteOnce({
            writer,
            linter,
            material,
            field,
            text: rewritten,
            violations: linter.lint(field, rewritten),
          });
          next[field] = repaired.text;
          violations.push(...repaired.violations);
        }
        if (violations.length > 0) {
          return {
            drop: {
              id: item.id,
              reason: "voice",
              unsupported: bad,
              violations,
              repairs: rewrittenFields.length,
            },
          };
        }
        // The spoken telling was written from the summary that was just rewritten, so it goes with it.
        if (rewrittenFields.includes("summary")) delete next.spoken;
        item = next;
        verdict = await check(item);
        const stillBad = unsupportedOf(verdict);
        if (stillBad.length > 0) {
          const pruned = prune(item, verdict, linter);
          if (pruned === null) {
            return {
              drop: {
                id: item.id,
                reason: "unsupported",
                unsupported: stillBad,
                violations: [],
                repairs: rewrittenFields.length,
              },
            };
          }
          item = pruned.item;
          prunedSentences = pruned.removed;
          verdict = {
            id: item.id,
            sentences: verdict.sentences.filter((s) => s.status !== "unsupported"),
          };
        }
      }

      const verified = !hasError(verdict);
      return {
        keep: { item, verified, rewrittenFields, checks: verdict.sentences, prunedSentences },
      };
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
