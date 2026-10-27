import {
  applyVotes,
  FETCH_VIA,
  GENERAL_TOPICS,
  isBuiltinCategory,
  isBuiltinSection,
  MAX_CUSTOM_TOPICS,
  type ParsedConfigOp,
  PROFILE_LABEL,
  type Preferences,
  profileBlocks,
  publishSection,
  RESERVED_TOPIC_IDS,
  type ScheduleFile,
  type Source,
  type SourceCandidatesFile,
  type SourcesFile,
  type SourcesUserFile,
  STRUCTURE_SECTIONS,
  type StructureFile,
  type Topic,
  type TopicsFile,
  TopicsFile as TopicsSchema,
  topicIdFromName,
  withGeneralScope,
  withoutSection,
  withSection,
  withSectionBlock,
} from "@singularity/core";
import type { ExaQuery, QueriesFile } from "../fetch/queries.js";
import { hostOf, normalizeDomain, type Profile } from "../profile/profile.js";
import { mergeOpens, mergeVotes } from "../profile/votes.js";
import { buildSourceFromUrl } from "../sources/addSource.js";
import type { DiscoverDeps } from "../sources/discover.js";

export class ConfigOpError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ConfigOpError";
  }
}

/** Everything `singularity config apply` can change, held in memory so an op either lands whole or not at all. */
export interface ConfigBundle {
  /** Built-in weights already read from the preferences. */
  topics: TopicsFile;
  preferences: Preferences;
  schedule: ScheduleFile;
  sourcesUser: SourcesUserFile;
  /** The merged registry, read only: used to find ids and pages that already exist. */
  registry: SourcesFile;
  queries: QueriesFile;
  candidates: SourceCandidatesFile;
  /** The owner's profile: today's only user (src/profile/profile.ts). */
  profile: Profile;
  /** config/structure.json (D170), or null while every kind runs its defaults. */
  structure: StructureFile | null;
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

const RESERVED_SECTIONS: readonly string[] = [
  "top",
  "watch",
  "design",
  "trending",
  ...GENERAL_TOPICS.map((topic) => topic.id),
];
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
    // A built-in topic keeps its description, section and flags, as fixed questions judge it; its
    // name, which the judge never reads, and its keywords are free to edit.
    const renamed = existing.name !== input.name;
    const summary = renamed
      ? `rename topic ${tidy(existing.name)} to ${tidy(input.name)}`
      : `set keywords of ${tidy(existing.name)}`;
    existing.name = input.name;
    existing.keywords = input.keywords;
    return { next, summary, topic_id: id, new_topic: false };
  }
  if (existing?.origin === "app" || existing?.origin === "general") {
    // A topic that ships with the app (Design, Trending, and the general news topics) keeps its
    // section and depth. Its fit question is built from its name and description, so editing either
    // re-judges this topic alone on the next run, and switching it off and on re-judges nothing. Its
    // sources are shipped with it, so no discovery queries are written.
    const reworded = existing.name !== input.name || existing.description !== input.description;
    const general = existing.origin === "general";
    const summary =
      reworded || general
        ? `update topic ${tidy(input.name)}`
        : `${input.enabled ? "turn on" : "turn off"} ${tidy(existing.name)}`;
    existing.name = input.name;
    existing.description = input.description;
    existing.keywords = [...new Set(input.keywords)];
    // A general topic is always on: the request's `enabled` is not read.
    existing.enabled = general ? true : input.enabled;
    return { next, summary, topic_id: id, new_topic: false };
  }
  if (input.origin === "builtin" || input.origin === "app" || input.origin === "general") {
    throw new ConfigOpError("Only the shipped topics are built in; a new topic is custom.");
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
  const section = next.topics.sections.find((candidate) => candidate.id === sectionId);
  if (section === undefined) {
    next.topics.sections.push({
      id: sectionId,
      title: input.section_title ?? input.name,
      order: nextSectionOrder(next.topics),
    });
  } else if (
    existing !== undefined &&
    existing.name !== input.name &&
    section.title === existing.name
  ) {
    // A renamed topic's own section is titled after it, so the briefing's heading follows the new
    // name. A section titled apart from the topic, or shared with others, keeps its title.
    section.title = input.section_title ?? input.name;
  }

  const topic: Topic = {
    id,
    name: input.name,
    description: input.description,
    enabled: input.enabled,
    keywords: [...new Set(input.keywords)],
    section_id: sectionId,
    never_publish: input.never_publish,
    origin: "custom",
    depth: input.depth,
  };
  const emoji = input.emoji ?? existing?.emoji;
  if (emoji !== undefined) topic.emoji = emoji;
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
  // A topic made after the structure was saved plays in every stored kind (D170, gap 2).
  if (wasNew && next.structure !== null) next.structure = withSection(next.structure, sectionId);
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
    throw new ConfigOpError("Built-in topics cannot be removed. Turn one off to silence it.");
  }
  if (topic.origin === "app" || topic.origin === "general") {
    throw new ConfigOpError(
      `${topic.name} ships with the app and cannot be removed. Turn it off instead.`,
    );
  }
  next.topics.topics = next.topics.topics.filter((candidate) => candidate.id !== op.id);
  // A removed topic leaves no trace in the episodes that left it out.
  const unskip = (ids: readonly string[]): string[] => ids.filter((id) => id !== op.id);
  next.schedule = {
    ...next.schedule,
    skip_topics: unskip(next.schedule.skip_topics),
    weekly: { ...next.schedule.weekly, skip_topics: unskip(next.schedule.weekly.skip_topics) },
    custom: { ...next.schedule.custom, skip_topics: unskip(next.schedule.custom.skip_topics) },
  };
  // A section a custom topic created goes with its last topic; a built-in section never goes.
  const stillUsed = next.topics.topics.some((t) => t.section_id === topic.section_id);
  if (!stillUsed && !isBuiltinSection(topic.section_id)) {
    next.topics.sections = next.topics.sections.filter((s) => s.id !== topic.section_id);
    if (next.structure !== null) next.structure = withoutSection(next.structure, topic.section_id);
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
  // A seed source the owner moved into the topic loses it as well. With no topic left, its override
  // stops naming topics, so the source returns to its own topics and category hint (an override
  // that names topics decides the hint, sources/registry.ts).
  for (const [id, override] of Object.entries(next.sourcesUser.overrides)) {
    if (!override.topic_ids?.includes(op.id)) continue;
    const { topic_ids: _own, ...rest } = override;
    const remaining = override.topic_ids.filter((topicId) => topicId !== op.id);
    const kept = remaining.length > 0 ? { ...rest, topic_ids: remaining } : rest;
    if (Object.keys(kept).length > 0) next.sourcesUser.overrides[id] = kept;
    else delete next.sourcesUser.overrides[id];
  }
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
  const taken = new Set([
    ...next.registry.sources.map((s) => s.id),
    ...next.sourcesUser.added.map((s) => s.id),
  ]);
  if (op.id !== undefined && taken.has(op.id))
    throw new ConfigOpError(`There is already a source ${op.id}.`);
  const source = await buildSourceFromUrl(
    {
      id: op.id,
      url: op.url,
      origin: "manual",
      topicIds: op.topic_ids,
      takenIds: taken,
      existing: [...next.registry.sources, ...next.sourcesUser.added],
    },
    deps.discover,
  ).catch((error: unknown) => {
    throw new ConfigOpError(error instanceof Error ? error.message : String(error), {
      cause: error,
    });
  });
  if (op.format !== undefined) source.format = op.format;
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

/** "A", "A and B", "A, B and C". */
function listInWords(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function updateSource(
  op: Extract<ParsedConfigOp, { op: "source.update" }>,
  bundle: ConfigBundle,
): OpOutcome {
  const next = clone(bundle);
  const topicIds = op.topic_ids === undefined ? undefined : [...new Set(op.topic_ids)];
  const topicNames = (topicIds ?? []).map((id) => {
    const topic = next.topics.topics.find((candidate) => candidate.id === id);
    if (!topic) throw new ConfigOpError(`There is no topic ${id}.`);
    return tidy(topic.name);
  });
  // An added source lives whole in sources.user.json and is changed there. A seed source lives in
  // sources.json, which is regenerated from sources.md, so its change is kept as an override.
  const added = next.sourcesUser.added.find((s) => s.id === op.id);
  const source = added ?? next.registry.sources.find((s) => s.id === op.id);
  if (!source) throw new ConfigOpError(`There is no source ${op.id}.`);
  const before = source.name;
  const via = op.fetch_via;
  if (via) {
    const host = new URL(source.url).hostname;
    if (host !== FETCH_VIA[via].host && !host.endsWith(`.${FETCH_VIA[via].host}`)) {
      throw new ConfigOpError(`${via} reads ${FETCH_VIA[via].host} only, not ${source.name}.`);
    }
    // Only the Firecrawl fetcher reads options.via, so any other type would persist a dead route.
    if (source.type !== "firecrawl") {
      throw new ConfigOpError(`${via} applies to a Firecrawl source only, not ${source.name}.`);
    }
  }
  if (via !== undefined) {
    // The fetcher reads options.via and options.category (engine/fetch/firecrawl.ts).
    const set: Record<string, string> =
      via === null ? {} : { via, category: FETCH_VIA[via].category };
    if (added) {
      const { via: _via, category: _category, ...rest } = added.options;
      added.options = { ...rest, ...set };
    } else {
      const { options: own, ...rest } = next.sourcesUser.overrides[op.id] ?? {};
      const { via: _via, category: _category, ...kept } = own ?? {};
      const options: Record<string, string> = { ...kept, ...set };
      // mergeUserSources keeps a seed's own options under an override, so a clear must mask them:
      // an empty value is no route to the fetcher, which compares options.via to a provider name.
      if (via === null) {
        for (const key of ["via", "category"]) {
          // `source` is the merged source: a key the override never set came from the seed file.
          if (source.options?.[key] !== undefined && own?.[key] === undefined) options[key] = "";
        }
      }
      next.sourcesUser.overrides[op.id] =
        Object.keys(options).length > 0 ? { ...rest, options } : rest;
    }
  }
  if (added) {
    if (op.name !== undefined) added.name = op.name;
    if (topicIds !== undefined) {
      if (topicIds.length > 0) added.topic_ids = topicIds;
      else delete added.topic_ids;
    }
    if (op.format !== undefined) added.format = op.format;
    if (op.lean !== undefined) added.lean = op.lean;
    if (op.high_signal !== undefined) added.high_signal = op.high_signal;
  } else {
    next.sourcesUser.overrides[op.id] = {
      ...next.sourcesUser.overrides[op.id],
      ...(op.format === undefined ? {} : { format: op.format }),
      ...(op.lean === undefined ? {} : { lean: op.lean }),
      ...(op.high_signal === undefined ? {} : { high_signal: op.high_signal }),
      ...(op.name === undefined ? {} : { name: op.name }),
      ...(topicIds === undefined ? {} : { topic_ids: topicIds }),
    };
  }
  const where = topicNames.length > 0 ? listInWords(topicNames) : "no topic";
  const rename = op.name === undefined ? null : `rename source ${tidy(before)} to ${tidy(op.name)}`;
  let summary: string;
  if (rename === null && topicIds === undefined) {
    summary =
      via !== undefined &&
      op.high_signal === undefined &&
      op.format === undefined &&
      op.lean === undefined
        ? `set how source ${tidy(before)} is fetched`
        : op.high_signal !== undefined && op.format === undefined && op.lean === undefined
          ? `${op.high_signal ? "favorite" : "unfavorite"} source ${tidy(before)}`
          : `set ${op.lean === undefined ? "format" : "lean"} of source ${tidy(before)}`;
  } else if (rename === null) summary = `move source ${tidy(before)} to ${where}`;
  else if (topicIds === undefined) summary = rename;
  else summary = `${rename} and move it to ${where}`;
  return { next, summary };
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

function setMix(op: Extract<ParsedConfigOp, { op: "topic.mix" }>, bundle: ConfigBundle): OpOutcome {
  const next = clone(bundle);
  const topic = next.topics.topics.find((t) => t.id === op.id);
  if (!topic) throw new ConfigOpError(`There is no topic ${op.id}.`);
  if (op.perspective !== 0 && topic.origin !== "general") {
    throw new ConfigOpError("Only a general news topic has a perspective.");
  }
  if (op.perspective === 0) delete topic.perspective;
  else topic.perspective = op.perspective;
  return { next, summary: `set the perspective of ${tidy(topic.name)}`, topic_id: topic.id };
}

/** The one type mix, kept in the preferences and read for every topic. */
function setFormatMix(
  op: Extract<ParsedConfigOp, { op: "mix.set" }>,
  bundle: ConfigBundle,
): OpOutcome {
  const next = clone(bundle);
  const mix = { ...next.preferences.format_mix };
  for (const [format, stop] of Object.entries(op.format_mix)) {
    if (stop === "Normal") delete mix[format as keyof typeof mix];
    else mix[format as keyof typeof mix] = stop;
  }
  if (Object.keys(mix).length > 0) next.preferences.format_mix = mix;
  else delete next.preferences.format_mix;
  const count = Object.keys(op.format_mix).length;
  return { next, summary: `set the type mix of ${count} type${count === 1 ? "" : "s"}` };
}

/** The topics an episode leaves out, checked against the known ones, each once. */
function skippedTopics(ids: readonly string[], bundle: ConfigBundle): string[] {
  const known = new Set(bundle.topics.topics.map((topic) => topic.id));
  for (const id of ids) {
    if (!known.has(id)) throw new ConfigOpError(`There is no topic ${id}.`);
  }
  return [...new Set(ids)];
}

function setSchedule(
  op: Extract<ParsedConfigOp, { op: "schedule.set" }>,
  bundle: ConfigBundle,
): OpOutcome {
  const next = clone(bundle);
  // Only an edit of a skip list writes the general topics into the lists (withGeneralScope).
  const current =
    op.skip_topics !== undefined || op.weekly?.skip_topics !== undefined
      ? withGeneralScope(bundle.schedule)
      : bundle.schedule;
  const skip =
    op.skip_topics !== undefined ? skippedTopics(op.skip_topics, next) : current.skip_topics;
  const weekly = { ...current.weekly, ...definedOnly(op.weekly) };
  if (op.weekly?.skip_topics !== undefined) {
    weekly.skip_topics = skippedTopics(op.weekly.skip_topics, next);
  }
  const hour = op.hour ?? current.hour;
  const cadence = op.cadence_days ?? current.cadence_days;
  next.schedule = {
    version: 1,
    timezone: op.timezone ?? current.timezone ?? "Europe/Stockholm",
    enabled: op.enabled ?? current.enabled,
    hour,
    cadence_days: cadence,
    skip_topics: skip,
    length_minutes: op.length_minutes ?? current.length_minutes,
    voice_id: op.voice_id !== undefined ? op.voice_id : current.voice_id,
    voice_id_b: op.voice_id_b !== undefined ? op.voice_id_b : current.voice_id_b,
    lookback_hours: op.lookback_hours !== undefined ? op.lookback_hours : current.lookback_hours,
    weekly,
    custom: { ...current.custom, ...definedOnly(op.custom) },
    ...(current.general_scoped === true ? { general_scoped: true } : {}),
  };
  if (op.custom?.skip_topics !== undefined) {
    next.schedule.custom.skip_topics = skippedTopics(op.custom.skip_topics, next);
  }
  // The top-level pair is every podcast's voice (podcastVoices): saving it clears a weekly or Create
  // voice left from before, so Default there means Default everywhere.
  for (const key of ["voice_id", "voice_id_b"] as const) {
    if (op[key] === undefined) continue;
    if (op.weekly?.[key] === undefined) next.schedule.weekly[key] = null;
    if (op.custom?.[key] === undefined) next.schedule.custom[key] = null;
  }
  const parts: string[] = [];
  if (op.timezone !== undefined) {
    parts.push(`set time zone to ${op.timezone}`);
  }
  if (op.hour !== undefined || op.cadence_days !== undefined) {
    parts.push(
      `set the briefing to ${String(hour).padStart(2, "0")}:00, every ${cadence} day${cadence === 1 ? "" : "s"}`,
    );
  }
  if (op.weekly) parts.push("set the weekly podcast");
  if (op.custom) parts.push("set the Create defaults");
  if (parts.length === 0) parts.push("set the daily podcast");
  return { next, summary: parts.join("; ") };
}

/**
 * Put topics in or out of the daily podcast, the weekly one and the Create panel (D69). It edits
 * the three skip lists in place rather than replacing them, so a topic page built before another
 * page's change never undoes it.
 */
function setScope(
  op: Extract<ParsedConfigOp, { op: "topic.scope" }>,
  bundle: ConfigBundle,
): OpOutcome {
  const next = clone(bundle);
  const ids = skippedTopics(op.ids, next);
  const scoped = (list: readonly string[], inScope: boolean | undefined): string[] => {
    if (inScope === undefined) return [...list];
    if (inScope) return list.filter((id) => !ids.includes(id));
    return [...new Set([...list, ...ids])];
  };
  const current =
    op.daily !== undefined || op.weekly !== undefined
      ? withGeneralScope(next.schedule)
      : next.schedule;
  next.schedule = {
    ...current,
    skip_topics: scoped(current.skip_topics, op.daily),
    weekly: { ...current.weekly, skip_topics: scoped(current.weekly.skip_topics, op.weekly) },
    custom: { ...current.custom, skip_topics: scoped(current.custom.skip_topics, op.custom) },
  };
  // A topic put into a stored kind gets its section block (D170, gap 2). Taking one out leaves the
  // block: the skip list leaves the topic out, and putting it back keeps its place.
  if (next.structure?.blocks !== undefined && (op.daily || op.weekly || op.custom)) {
    let blocks = next.structure.blocks;
    for (const id of ids) {
      // The section its stories are filed under: a general topic publishes under its own id.
      const topic = next.topics.topics.find((entry) => entry.id === id);
      const section = topic ? publishSection(topic) : undefined;
      if (section !== undefined) blocks = withSectionBlock(blocks, section);
    }
    next.structure = { ...next.structure, blocks };
  }
  const first = next.topics.topics.find((topic) => topic.id === ids[0]);
  return { next, summary: `set where ${tidy(first?.name ?? ids[0] ?? "a topic")} plays` };
}

/** Choose the profile and replace the blocks; every section block must name a section that exists. */
function setStructure(
  op: Extract<ParsedConfigOp, { op: "structure.set" }>,
  bundle: ConfigBundle,
): OpOutcome {
  const known = new Set<string>([
    ...STRUCTURE_SECTIONS,
    ...bundle.topics.topics.map((topic) => publishSection(topic)),
    ...GENERAL_TOPICS.map((topic) => topic.id),
  ]);
  for (const block of [...(op.blocks ?? []), ...(op.custom_blocks ?? [])]) {
    if (block.type === "section" && !known.has(block.id)) {
      throw new ConfigOpError(`There is no section ${block.id}.`);
    }
  }
  const next = clone(bundle);
  // A named profile sent alone runs its preset; the site sends the list with the owner's topics in it.
  const blocks = op.blocks ?? (op.profile === "custom" ? undefined : profileBlocks(op.profile));
  // A named profile keeps the owner's own list for a return to Custom: the one sent, or the list
  // that ran until now if it was Custom. Custom runs its list, so it keeps none apart.
  const was = bundle.structure;
  const kept =
    op.profile === "custom"
      ? undefined
      : (op.custom_blocks ??
        was?.custom_blocks ??
        ((was?.profile ?? "custom") === "custom" ? was?.blocks : undefined));
  const { custom_blocks: _dropped, ...rest } = was ?? {};
  next.structure = {
    ...rest,
    version: 1,
    profile: op.profile,
    ...(blocks === undefined ? {} : { blocks }),
    ...(kept === undefined ? {} : { custom_blocks: kept }),
  };
  return { next, summary: `set the structure to ${PROFILE_LABEL[op.profile]}` };
}

/** Replace one block's prompt in a kind (D182), or drop it so the built-in prompt applies. */
function setBlockPrompt(
  op: Extract<ParsedConfigOp, { op: "structure.prompt" }>,
  bundle: ConfigBundle,
): OpOutcome {
  const next = clone(bundle);
  const prompts = { ...(bundle.structure?.prompts ?? {}) };
  if (op.prompt === null) delete prompts[op.key];
  else prompts[op.key] = op.prompt;
  const { prompts: _old, ...rest } = bundle.structure ?? { version: 1 as const };
  next.structure = { ...rest, ...(Object.keys(prompts).length > 0 ? { prompts } : {}) };
  const block = op.key.replace(/^section:/, "").replace("_", " ");
  return {
    next,
    summary: `${op.prompt === null ? "reset" : "set"} the prompt for ${block}`,
  };
}

function definedOnly<T extends object>(value: T | undefined): Partial<T> {
  return Object.fromEntries(
    Object.entries(value ?? {}).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

function blockDomain(
  op: Extract<ParsedConfigOp, { op: "profile.block" }>,
  bundle: ConfigBundle,
): OpOutcome {
  const domain = normalizeDomain(op.domain);
  if (domain === null) throw new ConfigOpError(`"${tidy(op.domain, 60)}" is not a domain name.`);
  if (bundle.profile.blocked_domains.includes(domain)) {
    throw new ConfigOpError(`${domain} is already blocked.`);
  }
  const next = clone(bundle);
  next.profile.blocked_domains = [...next.profile.blocked_domains, domain].sort();
  return { next, summary: `block ${domain}` };
}

function unblockDomain(
  op: Extract<ParsedConfigOp, { op: "profile.unblock" }>,
  bundle: ConfigBundle,
): OpOutcome {
  const domain = normalizeDomain(op.domain);
  if (domain === null) throw new ConfigOpError(`"${tidy(op.domain, 60)}" is not a domain name.`);
  if (!bundle.profile.blocked_domains.includes(domain)) {
    throw new ConfigOpError(`${domain} is not blocked.`);
  }
  const next = clone(bundle);
  next.profile.blocked_domains = next.profile.blocked_domains.filter((d) => d !== domain);
  return { next, summary: `unblock ${domain}` };
}

function castVotes(
  op: Extract<ParsedConfigOp, { op: "profile.vote" }>,
  bundle: ConfigBundle,
): OpOutcome {
  const incoming = op.votes.map((vote) => {
    const domain = hostOf(vote.url);
    if (domain === null) throw new ConfigOpError(`"${tidy(vote.url, 60)}" has no usable host.`);
    return { ...vote, domain };
  });
  const opens = op.opens.map((open) => {
    const domain = hostOf(open.url);
    if (domain === null) throw new ConfigOpError(`"${tidy(open.url, 60)}" has no usable host.`);
    return { ...open, domain };
  });
  const next = clone(bundle);
  next.profile.auto_adjust = applyVotes(next.profile.auto_adjust, next.profile.votes, incoming);
  next.profile.votes = mergeVotes(next.profile.votes, incoming);
  next.profile.opens = mergeOpens(next.profile.opens, opens);
  const cleared = incoming.filter((vote) => vote.value === "clear").length;
  const cast = incoming.length - cleared;
  const parts = [
    cast > 0 ? `${cast} vote${cast === 1 ? "" : "s"}` : "",
    cleared > 0 ? `clear ${cleared}` : "",
    opens.length > 0 ? `${opens.length} open${opens.length === 1 ? "" : "s"}` : "",
  ];
  return { next, summary: `record ${parts.filter(Boolean).join(", ")}` };
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
    case "source.update":
      return updateSource(op, bundle);
    case "source.remove":
      return removeSource(op, bundle);
    case "topic.mix":
      return setMix(op, bundle);
    case "mix.set":
      return setFormatMix(op, bundle);
    case "schedule.set":
      return setSchedule(op, bundle);
    case "topic.scope":
      return setScope(op, bundle);
    case "structure.set":
      return setStructure(op, bundle);
    case "structure.prompt":
      return setBlockPrompt(op, bundle);
    case "profile.block":
      return blockDomain(op, bundle);
    case "profile.vote":
      return castVotes(op, bundle);
    case "profile.unblock":
      return unblockDomain(op, bundle);
    default: {
      const unreachable: never = op;
      throw new ConfigOpError(`Unknown op ${JSON.stringify(unreachable)}`);
    }
  }
}
