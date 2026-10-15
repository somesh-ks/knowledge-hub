import { CategoryId, DigestKind, VOICE_LIMITS } from "@dispatch/core";
import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true });

/**
 * One chosen item with its final text. The section is not stored: `dispatch render` derives it
 * from the category, the source type and the scores, so a hand-edited file cannot disagree with
 * the engine's rules.
 */
export const SelectionItem = z.object({
  id: z.string().regex(/^[0-9a-f]{12}$/, "must be a 12-character item id from the pool"),
  /** A built-in category or the id of a custom topic. */
  category: CategoryId,
  /** 0 to 1. Ranks the items: the three highest outside the sections with their own allowance become Top picks. */
  score: z.number().min(0).max(1),
  headline: z.string().min(1),
  summary: z.string().min(1),
  /** The host's telling of the story, for narration only. Optional: old files and agents have none. */
  spoken: z.string().min(1).optional(),
  /** The writer produces none. An agent session may still supply one, and old files carry it. */
  why: z.string().min(1).optional(),
});
export type SelectionItem = z.infer<typeof SelectionItem>;

/** `.cache/run/<id>/selection.json`: what `dispatch render` consumes. */
export const Selection = z.object({
  version: z.literal(1),
  kind: DigestKind,
  mode: z.enum(["api", "agent"]),
  /** "nothing" when too few items cleared the bar; items is then empty. */
  outcome: z.enum(["selected", "nothing"]),
  /**
   * True only when every item passed the grounding check. Always false in agent mode, and
   * `dispatch render` enforces that. Written by the engine; a session writes agent-selection.json.
   */
  verified: z.boolean(),
  window: z.object({ from: isoDateTime, to: isoDateTime }),
  items: z.array(SelectionItem),
  /**
   * Stories the owner's length airs, when the briefing carries spares beyond it (scheduleSize.ts):
   * validation keeps this many of the survivors. Absent airs every item.
   */
  wanted: z.number().int().positive().optional(),
});
export type Selection = z.infer<typeof Selection>;

/**
 * What a Claude Code session writes in agent mode. Only the items are required; the engine
 * adds kind, window and the rest. Extra fields are ignored. This schema is written to
 * `selection-schema.json` as JSON Schema.
 */
export const AgentSelection = z.object({
  version: z.literal(1),
  /** At most the digest hard maximum. The command checks each pool and section for the kind. */
  items: z.array(SelectionItem).min(VOICE_LIMITS.items.floor).max(VOICE_LIMITS.items.hardMax),
});
export type AgentSelection = z.infer<typeof AgentSelection>;

export const DROP_STAGES = ["judge", "select", "extract", "write", "voice", "grounding"] as const;
export type DropStage = (typeof DROP_STAGES)[number];

export const WrittenEntry = z.object({
  id: z.string(),
  headline: z.string(),
  summary: z.string(),
  spoken: z.string().optional(),
  why: z.string().optional(),
  extract_method: z.string().optional(),
  rewritten_fields: z.array(z.string()),
  verified: z.boolean(),
  grounding: z.array(
    z.object({
      field: z.string(),
      sentence: z.string(),
      score: z.number().nullable(),
      status: z.enum(["supported", "unsupported", "error"]),
    }),
  ),
});

/** `.cache/run/<id>/written.json`: the written items with how each was produced, plus every drop. */
export const WrittenFile = z.object({
  version: z.literal(1),
  items: z.array(WrittenEntry),
  dropped: z.array(z.object({ id: z.string(), stage: z.enum(DROP_STAGES), reason: z.string() })),
});
export type WrittenFile = z.infer<typeof WrittenFile>;

/** The JSON Schema a session validates `selection.json` against. */
export function agentSelectionJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(AgentSelection) as Record<string, unknown>;
}
