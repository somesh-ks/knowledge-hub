import { z } from "zod";
import { IdString, SectionId } from "./categories.js";
import { ScheduleChange } from "./schedule.js";
import { SOURCE_NAME_MAX } from "./sources.js";
import { MAX_KEYWORDS, TOPIC_DEPTHS, TOPIC_ORIGINS } from "./topics.js";
import { WriterSettingsShape, writerModelProblem } from "./writer.js";

const weight = z.number().min(0).max(1);

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
 * - source.add: add a source by URL; its feed is discovered when the op runs.
 * - source.set: switch a source on or off, or pin it. Works on seed and added sources.
 * - source.update: rename a source (1 to 80 characters, trimmed), set the topics it feeds, or both.
 *   An added source is changed in place; a seed source keeps the change in its override, which
 *   wins over the seed's own name and topics. An empty topic list leaves it feeding none of its
 *   own. Unknown source or topic ids are refused.
 * - source.remove: delete an added source, or hide a seed source.
 * - weights.set: set weights by topic id. Built-in weights are written to config/preferences.json.
 * - schedule.set: set any of the daily hour (Stockholm), cadence, topics left out (`skip_topics`),
 *   podcast type, length and voices, the weekly podcast (`weekly`: on/off, day, hour, topics left
 *   out, type, length, voices) and the Create panel defaults (`custom`), in config/schedule.json, in
 *   one write. Fields left out keep what the file holds. Unknown topic ids are refused.
 * - writer.set: set the writer's provider and model in config/writer.json. A null model means
 *   the engine's own DISPATCH_MODEL.
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
    })
    .refine((value) => value.name !== undefined || value.topic_ids !== undefined, {
      message: "set name, topic_ids or both",
    }),
  z.object({ op: z.literal("source.remove"), id: z.string().min(1) }),
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
  z
    .object({ op: z.literal("writer.set"), ...WriterSettingsShape.shape })
    .superRefine((value, ctx) => {
      const problem = writerModelProblem(value.provider, value.model);
      if (problem) ctx.addIssue({ code: "custom", path: ["model"], message: problem });
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
