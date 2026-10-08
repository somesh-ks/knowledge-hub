import { z } from "zod";
import { IdString, SectionId } from "./categories.js";
import { MAX_KEYWORDS, TOPIC_DEPTHS, TOPIC_ORIGINS } from "./topics.js";

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
 * - source.remove: delete an added source, or hide a seed source.
 * - weights.set: set weights by topic id. Built-in weights are written to config/preferences.json.
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
  z.object({ op: z.literal("source.remove"), id: z.string().min(1) }),
  z.object({
    op: z.literal("weights.set"),
    weights: z
      .record(IdString, weight)
      .refine((value) => Object.keys(value).length > 0, "give at least one weight"),
  }),
]);
/** The op as a caller writes it, before defaults are filled in. */
export type ConfigOp = z.input<typeof ConfigOp>;
/** The op after validation, with every default applied. */
export type ParsedConfigOp = z.output<typeof ConfigOp>;
