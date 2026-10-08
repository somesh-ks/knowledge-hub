import {
  isBuiltinCategory,
  isBuiltinSection,
  MAX_CUSTOM_TOPICS,
  type ParsedConfigOp,
  type Preferences,
  RESERVED_TOPIC_IDS,
  type Source,
  type SourceCandidatesFile,
  type SourcesFile,
  type SourcesUserFile,
  type Topic,
  type TopicsFile,
  TopicsFile as TopicsSchema,
  topicIdFromName,
} from "@dispatch/core";
import type { ExaQuery, QueriesFile } from "../fetch/queries.js";
import { buildSourceFromUrl } from "../sources/addSource.js";
import type { DiscoverDeps } from "../sources/discover.js";

export class ConfigOpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigOpError";
  }
}

/** Everything `dispatch config apply` can change, held in memory so an op either lands whole or not at all. */
export interface ConfigBundle {
  /** Built-in weights already read from the preferences. */
  topics: TopicsFile;
  preferences: Preferences;
  sourcesUser: SourcesUserFile;
  /** The merged registry, read only: used to find ids and pages that already exist. */
  registry: SourcesFile;
  queries: QueriesFile;
  candidates: SourceCandidatesFile;
}

export interface ApplyDeps {
  discover: DiscoverDeps;
}

export interface OpOutcome {
  next: ConfigBundle;
  /** One short line for the commit subject, without a type prefix. */
  summary: string;
  /** The topic the op touched, when it touched one. */
  topic_id?: string;
  /** True when `topic.upsert` created the topic, so the workflow can look for sources for it. */
  new_topic?: boolean;
}

const RESERVED_SECTIONS: readonly string[] = ["top", "watch"];
const QUERY_ID = /^[a-z0-9][a-z0-9-]*$/;

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Single line, no control characters, shortened: safe to put in a commit subject. */
export function tidy(text: string, max = 40): string {
  const flat = text
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 3).trimEnd()}...`;
}

function queryIds(topicId: string): [string, string] {
  const base = topicId.replace(/_/g, "-");
  return [`${base}-latest`, `${base}-analysis`];
}

/**
 * Two discovery queries for a topic: its name with the leading keywords, and its description.
 * Built without a model call so adding a topic costs nothing until the next run's search.
 */
export function queriesForTopic(
  topic: Pick<Topic, "id" | "name" | "description" | "keywords">,
): ExaQuery[] {
  const [first, second] = queryIds(topic.id);
  const lead = [topic.name, ...topic.keywords.slice(0, 3)].join(" ").slice(0, 160);
  const queries: ExaQuery[] = [{ id: first, query: lead, topic_id: topic.id }];
  const description = topic.description.slice(0, 240);
  if (description.toLowerCase() !== lead.toLowerCase()) {
    queries.push({ id: second, query: description, topic_id: topic.id });
  }
  for (const query of queries) {
    if (!QUERY_ID.test(query.id))
      throw new ConfigOpError(`Cannot build a query id for ${topic.id}.`);
  }
  return queries;
}

function withoutTopicQueries(queries: QueriesFile, topicId: string): QueriesFile {
  return { ...queries, queries: queries.queries.filter((q) => q.topic_id !== topicId) };
}

function nextSectionOrder(topics: TopicsFile): number {
  return topics.sections.reduce((max, section) => Math.max(max, section.order), 0) + 1;
}

function upsertTopic(
  op: Extract<ParsedConfigOp, { op: "topic.upsert" }>,
  bundle: ConfigBundle,
): OpOutcome {
  const next = clone(bundle);
  const input = op.topic;
  const id = input.id ?? topicIdFromName(input.name);
  const existing = next.topics.topics.find((topic) => topic.id === id);

  if (existing?.origin === "builtin") {
    // A built-in topic keeps its judge question, section and flags. Its weight lives in the
    // preferences, where `dispatch learn` also writes it, and its keywords are free to edit.
    existing.weight = input.weight;
    existing.keywords = input.keywords;
    if (isBuiltinCategory(existing.id)) next.preferences.weights[existing.id] = input.weight;
    return {
      next,
      summary: `set weight of ${tidy(existing.name)}`,
      topic_id: id,
      new_topic: false,
    };
  }
  if (input.origin === "builtin") {
    throw new ConfigOpError("Only the built-in topics are built in; a new topic is custom.");
  }
  if (existing === undefined) {
    if (isBuiltinCategory(id) || RESERVED_TOPIC_IDS.includes(id)) {
      throw new ConfigOpError(`${id} is reserved. Choose another name.`);
    }
    const custom = next.topics.topics.filter((topic) => topic.origin === "custom").length;
    if (custom >= MAX_CUSTOM_TOPICS) {
      throw new ConfigOpError(`At most ${MAX_CUSTOM_TOPICS} custom topics. Remove one first.`);
    }
  }

  const sectionId = input.section_id ?? existing?.section_id ?? id;
  if (RESERVED_SECTIONS.includes(sectionId)) {
    throw new ConfigOpError(`${sectionId} is filled by the engine; pick another section.`);
  }
  if (!next.topics.sections.some((section) => section.id === sectionId)) {
    next.topics.sections.push({
      id: sectionId,
      title: input.section_title ?? input.name,
      order: nextSectionOrder(next.topics),
    });
  }

  const topic: Topic = {
    id,
    name: input.name,
    description: input.description,
    weight: input.weight,
    enabled: input.enabled,
    keywords: [...new Set(input.keywords)],
    section_id: sectionId,
    never_publish: input.never_publish,
    origin: "custom",
    depth: input.depth,
  };
  const wasNew = existing === undefined;
  // Queries follow the wording: written once for a new topic, and again when the wording changed.
  const reworded =
    existing === undefined ||
    existing.name !== topic.name ||
    existing.description !== topic.description ||
    existing.keywords.join("\n") !== topic.keywords.join("\n");
  if (existing === undefined) next.topics.topics.push(topic);
  else Object.assign(existing, topic);
  const hadQueries = next.queries.queries.some((query) => query.topic_id === id);
  if (reworded || !hadQueries) {
    next.queries = withoutTopicQueries(next.queries, id);
    next.queries.queries.push(...queriesForTopic(topic));
  }

  const checked = TopicsSchema.safeParse(next.topics);
  if (!checked.success) {
    throw new ConfigOpError(
      checked.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
    );
  }
  return {
    next,
    summary: `${wasNew ? "add" : "update"} topic ${tidy(input.name)}`,
    topic_id: id,
    new_topic: wasNew,
  };
}

function removeTopic(
  op: Extract<ParsedConfigOp, { op: "topic.remove" }>,
  bundle: ConfigBundle,
): OpOutcome {
  const next = clone(bundle);
  const topic = next.topics.topics.find((candidate) => candidate.id === op.id);
  if (!topic) throw new ConfigOpError(`There is no topic ${op.id}.`);
  if (topic.origin === "builtin") {
    throw new ConfigOpError(
      "Built-in topics cannot be removed. Set the weight to 0 to silence one.",
    );
  }
  next.topics.topics = next.topics.topics.filter((candidate) => candidate.id !== op.id);
  // A section a custom topic created goes with its last topic; a built-in section never goes.
  const stillUsed = next.topics.topics.some((t) => t.section_id === topic.section_id);
  if (!stillUsed && !isBuiltinSection(topic.section_id)) {
    next.topics.sections = next.topics.sections.filter((s) => s.id !== topic.section_id);
  }
  next.queries = withoutTopicQueries(next.queries, op.id);

  // Sources found for the topic go with it, unless a person pinned them or they feed other topics.
  const added: Source[] = [];
  for (const source of next.sourcesUser.added) {
    if (!source.topic_ids?.includes(op.id)) {
      added.push(source);
      continue;
    }
    const { topic_ids: _own, ...rest } = source;
    const remaining = source.topic_ids.filter((id) => id !== op.id);
    if (remaining.length === 0 && source.origin === "auto" && source.pinned !== true) {
      delete next.sourcesUser.overrides[source.id];
      continue;
    }
    added.push(remaining.length > 0 ? { ...rest, topic_ids: remaining } : rest);
  }
  next.sourcesUser.added = added;
  delete next.candidates.topics[op.id];
  return { next, summary: `remove topic ${tidy(topic.name)}`, topic_id: op.id, new_topic: false };
}

async function addSource(
  op: Extract<ParsedConfigOp, { op: "source.add" }>,
  bundle: ConfigBundle,
  deps: ApplyDeps,
): Promise<OpOutcome> {
  const next = clone(bundle);
  const known = new Set(next.topics.topics.map((topic) => topic.id));
  for (const id of op.topic_ids ?? []) {
    if (!known.has(id)) throw new ConfigOpError(`There is no topic ${id}.`);
  }
  const source = await buildSourceFromUrl(
    {
      url: op.url,
      origin: "manual",
      topicIds: op.topic_ids,
      takenIds: new Set([
        ...next.registry.sources.map((s) => s.id),
        ...next.sourcesUser.added.map((s) => s.id),
      ]),
      existing: [...next.registry.sources, ...next.sourcesUser.added],
    },
    deps.discover,
  ).catch((error: unknown) => {
    throw new ConfigOpError(error instanceof Error ? error.message : String(error));
  });
  next.sourcesUser.added.push(source);
  return { next, summary: `add source ${tidy(source.name)}` };
}

function setSource(
  op: Extract<ParsedConfigOp, { op: "source.set" }>,
  bundle: ConfigBundle,
): OpOutcome {
  const next = clone(bundle);
  const source = next.registry.sources.find((s) => s.id === op.id);
  if (!source) throw new ConfigOpError(`There is no source ${op.id}.`);
  const override = { ...next.sourcesUser.overrides[op.id] };
  if (op.enabled !== undefined) override.enabled = op.enabled;
  if (op.pinned !== undefined) override.pinned = op.pinned;
  next.sourcesUser.overrides[op.id] = override;
  const parts = [
    op.enabled === undefined ? null : op.enabled ? "enable" : "disable",
    op.pinned === undefined ? null : op.pinned ? "pin" : "unpin",
  ].filter((part): part is string => part !== null);
  return { next, summary: `${parts.join(" and ")} source ${tidy(source.name)}` };
}

function removeSource(
  op: Extract<ParsedConfigOp, { op: "source.remove" }>,
  bundle: ConfigBundle,
): OpOutcome {
  const next = clone(bundle);
  const source = next.registry.sources.find((s) => s.id === op.id);
  if (!source) throw new ConfigOpError(`There is no source ${op.id}.`);
  if (next.sourcesUser.added.some((s) => s.id === op.id)) {
    // An added source is deleted outright; nothing in sources.json remembers it.
    next.sourcesUser.added = next.sourcesUser.added.filter((s) => s.id !== op.id);
    delete next.sourcesUser.overrides[op.id];
  } else {
    // A seed source stays in sources.json, which is regenerated from sources.md; hiding it here survives that.
    next.sourcesUser.overrides[op.id] = { ...next.sourcesUser.overrides[op.id], removed: true };
  }
  return { next, summary: `remove source ${tidy(source.name)}` };
}

function setWeights(
  op: Extract<ParsedConfigOp, { op: "weights.set" }>,
  bundle: ConfigBundle,
): OpOutcome {
  const next = clone(bundle);
  for (const [id, weight] of Object.entries(op.weights)) {
    const topic = next.topics.topics.find((t) => t.id === id);
    if (!topic) throw new ConfigOpError(`There is no topic ${id}.`);
    topic.weight = weight;
    if (topic.origin === "builtin" && isBuiltinCategory(id)) next.preferences.weights[id] = weight;
  }
  const count = Object.keys(op.weights).length;
  return { next, summary: `set ${count} topic weight${count === 1 ? "" : "s"}` };
}

/**
 * Apply one validated op to the configuration. Pure apart from the feed lookup `source.add`
 * makes through the injected client. Throws ConfigOpError with a message for the person who sent
 * the op; nothing is written until the caller has the whole result.
 */
export async function applyConfigOp(
  op: ParsedConfigOp,
  bundle: ConfigBundle,
  deps: ApplyDeps,
): Promise<OpOutcome> {
  switch (op.op) {
    case "topic.upsert":
      return upsertTopic(op, bundle);
    case "topic.remove":
      return removeTopic(op, bundle);
    case "source.add":
      return addSource(op, bundle, deps);
    case "source.set":
      return setSource(op, bundle);
    case "source.remove":
      return removeSource(op, bundle);
    case "weights.set":
      return setWeights(op, bundle);
    default: {
      const unreachable: never = op;
      throw new ConfigOpError(`Unknown op ${JSON.stringify(unreachable)}`);
    }
  }
}
