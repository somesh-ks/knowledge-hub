import { z } from "zod";
import { IdString, SectionId, snapWeight } from "./categories.js";
import { ScheduleChange } from "./schedule.js";
import { SOURCE_NAME_MAX, SourceFormat } from "./sources.js";
import {
  BlockPrompt,
  BlockPromptKey,
  kindProblems,
  promptProblems,
  StructureBlocks,
  StructureKind,
} from "./structure.js";
import {
  MAX_KEYWORDS,
  MixStop,
  mixStopOf,
  Perspective,
  TOPIC_DEPTHS,
  TOPIC_ORIGINS,
} from "./topics.js";

/** A like or dislike of one story, as the app sends it. */
export const VoteInput = z.object({
  story_id: z.string().trim().min(1).max(200),
  url: z
    .string()
    .trim()
    .max(2000)
    .url()
    .refine((value) => /^https?:\/\//i.test(value), "must be an http or https URL"),
  headline: z.string().trim().min(1).max(200),
  topic: z.string().trim().min(1).max(100),
  source_id: z.string().trim().min(1).max(100),
  value: z.enum(["up", "down", "clear"]),
  at: z.string().datetime({ offset: true }),
});
export const MAX_VOTES_PER_OP = 50;

/**
 * A story the reader opened at its source, as the app sends it: a weak like, read by the taste
 * check (engine profile/tasteFit.ts). Opens ride along with votes and never trigger a save alone
 * before they are a day old (apps/web lib/storyVotes.ts), since every save is a commit.
 */
export const OpenInput = VoteInput.omit({ value: true });
export const MAX_OPENS_PER_OP = 50;

/** Any number from 0 to 1 is read as the nearest of the five weight stops. */
const weight = z.number().min(0).max(1).transform(snapWeight);

/**
 * A topic as the app submits it. Only `name` and `description` are required: the id comes from
 * the name, a new topic gets a section of its own titled after it, and the rest take defaults.
 * A full `Topic` from config/topics.json is accepted as well, so an edit can send back what it
 * read. `origin` can only be "custom" for a topic that does not exist yet.
 */
export const TopicInput = z.object({
  id: IdString.optional(),
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(400),
  weight: weight.default(0.7),
  enabled: z.boolean().default(true),
  keywords: z.array(z.string().trim().min(1).max(60)).max(MAX_KEYWORDS).default([]),
  /** Defaults to the topic's own id. A section that does not exist yet is created. */
  section_id: SectionId.optional(),
  /** Title for a section this op creates. Defaults to the topic name. */
  section_title: z.string().trim().min(1).max(60).optional(),
  never_publish: z.boolean().default(false),
  /** One emoji for the topic's row; Jev picks it when the owner adds a topic. Left out keeps the stored one. */
  emoji: z.string().trim().min(1).max(16).optional(),
  origin: z.enum(TOPIC_ORIGINS).optional(),
  depth: z.enum(TOPIC_DEPTHS).default("fit_only"),
});
export type TopicInput = z.input<typeof TopicInput>;

/**
 * One change to the user-editable configuration. `dispatch config apply --op '<json>'` takes
 * exactly one per call, and the config workflow passes it through unchanged.
 *
 * - topic.upsert: create a custom topic, or edit one. For a built-in topic only `weight` and
 *   `keywords` may change.
 * - topic.remove: delete a custom topic and the discovery queries written for it.
 * - source.add: add a source by URL; its feed is discovered when the op runs. An `id` may be given
 *   (refused when taken); otherwise one is made from the address.
 * - source.set: switch a source on or off, or pin it. Works on seed and added sources.
 * - source.update: rename a source (1 to 80 characters, trimmed), set the topics it feeds, or both.
 *   An added source is changed in place; a seed source keeps the change in its override, which
 *   wins over the seed's own name and topics. An empty topic list leaves it feeding none of its
 *   own. Unknown source or topic ids are refused.
 * - source.remove: delete an added source, or hide a seed source.
 * - topic.mix: set a general topic's perspective (-2 Left to 2 Right).
 * - mix.set: set the type mix, one stop per source format, for every topic alike, in
 *   config/preferences.json. Formats left out keep their stop; Normal removes one.
 * - weights.set: set weights by topic id. Built-in weights are written to config/preferences.json.
 * - schedule.set: set any of the time zone (one of SUPPORTED_TIMEZONES), the daily hour, cadence,
 *   topics left out (`skip_topics`), length and voices, the weekly podcast (`weekly`:
 *   on/off, day, hour, topics left out, type, length, voices) and the Create panel defaults
 *   (`custom`), in config/schedule.json, in one write. Fields left out keep what the file holds.
 *   Unknown topic ids and zones outside the list are refused.
 * - profile.block / profile.unblock: add or remove a domain in the owner's blocklist
 *   (config/profiles/owner.json). A blocked domain and its subdomains never reach a briefing or an
 *   episode. A URL or `www.` form is accepted and reduced to the domain.
 * - profile.vote: store 1 to 50 likes or dislikes of stories in the owner's profile, one per story
 *   (a later one replaces an earlier one; "clear" removes it). The engine derives the domain from
 *   the URL. Votes shape later source choice, ranking and what the writer leads with.
 * - structure.set: replace one podcast kind's whole list of blocks (D170) in config/structure.json,
 *   as weights.set replaces weights: idempotent, no index arithmetic on the wire.
 * - structure.prompt: replace one block's prompt in one kind (D178), or put back the built-in
 *   prompt with null. Daily and weekly take prompts for story blocks only.
 */
export const ConfigOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("topic.upsert"), topic: TopicInput }),
  z.object({ op: z.literal("topic.remove"), id: IdString }),
  z.object({
    op: z.literal("source.add"),
    url: z
      .string()
      .url()
      .refine((value) => /^https?:\/\//i.test(value), "must be an http or https URL"),
    topic_ids: z.array(IdString).max(MAX_KEYWORDS).optional(),
    /** The id the page chose, so its row can be edited before the build lists the source. Refused if taken. */
    id: IdString.optional(),
    /** The format the person chose or accepted; left out, the type's rule decides. */
    format: SourceFormat.optional(),
  }),
  z
    .object({
      op: z.literal("source.set"),
      id: z.string().min(1),
      enabled: z.boolean().optional(),
      pinned: z.boolean().optional(),
    })
    .refine((value) => value.enabled !== undefined || value.pinned !== undefined, {
      message: "set enabled, pinned or both",
    }),
  z
    .object({
      op: z.literal("source.update"),
      id: z.string().min(1),
      name: z.string().trim().min(1).max(SOURCE_NAME_MAX).optional(),
      topic_ids: z.array(IdString).max(MAX_KEYWORDS).optional(),
      format: SourceFormat.optional(),
      /** A general source's political lean, -2 to 2; null clears it. */
      lean: z.number().int().min(-2).max(2).nullable().optional(),
    })
    .refine(
      (value) =>
        value.name !== undefined ||
        value.topic_ids !== undefined ||
        value.format !== undefined ||
        value.lean !== undefined,
      { message: "set name, topic_ids, format, lean or any of them" },
    ),
  z.object({ op: z.literal("source.remove"), id: z.string().min(1) }),
  // A general topic's perspective (D124); 0 (Even) removes it.
  z.object({ op: z.literal("topic.mix"), id: IdString, perspective: Perspective }),
  // The one type mix for every topic. Each given format takes the nearest mix stop (Normal removes it).
  z.object({
    op: z.literal("mix.set"),
    format_mix: z
      .partialRecord(
        SourceFormat,
        z.union([MixStop, z.number().min(0).max(1.2).transform(mixStopOf)]),
      )
      .refine((value) => Object.keys(value).length > 0, "give at least one type"),
  }),
  z.object({
    op: z.literal("weights.set"),
    weights: z
      .record(IdString, weight)
      .refine((value) => Object.keys(value).length > 0, "give at least one weight"),
  }),
  z
    .object({ op: z.literal("schedule.set"), ...ScheduleChange.shape })
    .refine(
      (value) => Object.entries(value).some(([key, entry]) => key !== "op" && entry !== undefined),
      {
        message: "set at least one field",
      },
    ),
  // Where topics play (D69): each scope that is given puts the topics in (true) or takes them out
  // (false) of the daily podcast, the weekly one or the Create panel. One of the owner's four
  // topics sends every judge topic it gathers. It edits the lists in place, so two pages built
  // before either change never undo each other.
  z
    .object({
      op: z.literal("topic.scope"),
      ids: z.array(IdString).min(1).max(50),
      daily: z.boolean().optional(),
      weekly: z.boolean().optional(),
      custom: z.boolean().optional(),
    })
    .refine(
      (value) =>
        value.daily !== undefined || value.weekly !== undefined || value.custom !== undefined,
      { message: "set at least one scope" },
    ),
  z
    .object({ op: z.literal("structure.set"), kind: StructureKind, blocks: StructureBlocks })
    .superRefine((value, ctx) => {
      for (const message of kindProblems(value.kind, value.blocks)) {
        ctx.addIssue({ code: "custom", message, path: ["blocks"] });
      }
    }),
  // One block's prompt (D178), apart from structure.set so a reorder never carries prompts and a
  // prompt of six thousand characters fits one request. null puts back the built-in prompt.
  z
    .object({
      op: z.literal("structure.prompt"),
      kind: StructureKind,
      key: BlockPromptKey,
      prompt: BlockPrompt.nullable(),
    })
    .superRefine((value, ctx) => {
      for (const message of promptProblems(value.kind, [value.key])) {
        ctx.addIssue({ code: "custom", message, path: ["key"] });
      }
    }),
  // The domain is normalised and checked by the engine, which refuses what is not a host name.
  z.object({ op: z.literal("profile.block"), domain: z.string().trim().min(1).max(300) }),
  z.object({ op: z.literal("profile.unblock"), domain: z.string().trim().min(1).max(300) }),
  z
    .object({
      op: z.literal("profile.vote"),
      votes: z.array(VoteInput).max(MAX_VOTES_PER_OP),
      opens: z.array(OpenInput).max(MAX_OPENS_PER_OP).default([]),
    })
    .refine((value) => value.votes.length + value.opens.length > 0, {
      message: "send at least one vote or open",
    }),
]);
/** The op as a caller writes it, before defaults are filled in. */
export type ConfigOp = z.input<typeof ConfigOp>;
/** The op after validation, with every default applied. */
export type ParsedConfigOp = z.output<typeof ConfigOp>;

/** Most ops one request may carry: a topic and the handful of sources ticked for it. */
export const MAX_CONFIG_OPS = 8;

/** An array of 1 to 8 ops. */
export const ConfigOpList = z.array(ConfigOp).min(1).max(MAX_CONFIG_OPS);

/**
 * One request's worth of changes: a single op, or an array of 1 to 8. A single op is wrapped, so
 * the parsed value is always an array. `dispatch config apply --op` takes either form: every op
 * is validated before any is applied, they apply in the order given (so a `topic.upsert` can
 * precede the `source.add` ops hinted to it), and the batch lands as one commit or not at all.
 */
export const ConfigOpBatch = z.preprocess(
  (value) => (Array.isArray(value) ? value : [value]),
  ConfigOpList,
);
/** The batch as a caller writes it: one op, or an array of them. */
export type ConfigOpBatch = ConfigOp | ConfigOp[];
/** The batch after validation: always an array, defaults applied. */
export type ParsedConfigOpBatch = ParsedConfigOp[];

export type ConfigOpsResult =
  | { success: true; data: ParsedConfigOpBatch }
  | { success: false; issues: { path: (string | number)[]; message: string }[] };

/**
 * Validate one op or an array of ops. A single op reports problems at the paths it always did
 * (`topic.name`); inside an array each path starts with the op's position.
 */
export function parseConfigOps(json: unknown): ConfigOpsResult {
  const parsed = Array.isArray(json) ? ConfigOpList.safeParse(json) : ConfigOp.safeParse(json);
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map((part) => (typeof part === "symbol" ? String(part) : part)),
        message: issue.message,
      })),
    };
  }
  return { success: true, data: Array.isArray(parsed.data) ? parsed.data : [parsed.data] };
}
