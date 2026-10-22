import { isGeneralTopicId, MIX_STOPS } from "@dispatch/core";
import { blockedDomainsIn } from "../lib/blockedProfile";
import { configHash } from "../lib/configHash";
import { buildManage, type ManageData, type ManageSource, type ManageTopic } from "../lib/manage";
import { type ScheduleView, scheduleViewOf } from "../lib/schedule";
import { OTHER_ID, topicLayout } from "../lib/topicPages";
import type { ConfigOp, StoreSource } from "../types/contracts";

export type { StoreSource };

/**
 * What a page needs to show the stored config (D149) over the copy it was built with: the edits
 * that turn the build's files into the stored ones, as the ops the app sends, so the pages lay
 * them over the built page the way they already lay a just-saved edit (lib/savedOverlay.ts,
 * scripts/savedView.ts). The function is built from the same commit as the pages, so the files it
 * bundles are exactly what the pages were built from.
 *
 * Only what the built pages publish goes in: topics, sources, the schedule, the weights and type
 * mix, the blocked outlets. Never votes, opens, the learning history, the writer or the queries.
 */

export interface StoreChanges {
  ops: ConfigOp[];
  sources: StoreSource[];
}

/** The public files, by repository path: the build's, or the store's laid over them. */
export type ConfigFiles = Readonly<Record<string, string | undefined>>;

function json(text: string | undefined): unknown {
  if (text === undefined) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function manageOf(files: ConfigFiles): ManageData {
  return buildManage({
    topicsFile: json(files["config/topics.json"]),
    preferences: json(files["config/preferences.json"]),
    registry: json(files["config/sources.json"]),
    user: json(files["config/sources.user.json"]),
    stats: null,
    health: null,
    candidates: null,
  });
}

/** The page each source is listed on, by source id. */
function pagesOf(data: ManageData): Map<string, string> {
  const pages = new Map<string, string>();
  for (const [page, list] of topicLayout(data.topics, data.sources).sources)
    for (const source of list) pages.set(source.id, page);
  return pages;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function topicOps(built: ManageTopic[], stored: ManageTopic[]): ConfigOp[] {
  const ops: ConfigOp[] = [];
  const was = new Map(built.map((topic) => [topic.id, topic]));
  const weights: Record<string, number> = {};
  for (const topic of stored) {
    const before = was.get(topic.id);
    const { id, name, description, weight, enabled, keywords, section_id, emoji } = topic;
    if (
      !before ||
      before.name !== name ||
      before.description !== description ||
      before.enabled !== enabled ||
      before.emoji !== emoji ||
      !same(before.keywords, keywords)
    ) {
      ops.push({
        op: "topic.upsert",
        topic: {
          id,
          name,
          description,
          weight,
          enabled,
          keywords,
          section_id,
          ...(emoji ? { emoji } : {}),
        },
      });
    }
    if (before && before.weight !== weight) weights[id] = weight;
    if (before && (before.perspective ?? 0) !== (topic.perspective ?? 0))
      ops.push({ op: "topic.mix", id, perspective: topic.perspective ?? 0 });
  }
  const kept = new Set(stored.map((topic) => topic.id));
  for (const topic of built)
    if (!kept.has(topic.id) && topic.origin === "custom")
      ops.push({ op: "topic.remove", id: topic.id });
  if (Object.keys(weights).length > 0) ops.push({ op: "weights.set", weights });
  return ops;
}

const factorOf = (stop: string | undefined): number =>
  MIX_STOPS.find((each) => each.name === stop)?.factor ?? 1;

function mixOps(built: Record<string, string>, stored: Record<string, string>): ConfigOp[] {
  const format_mix: Record<string, number> = {};
  for (const format of new Set([...Object.keys(built), ...Object.keys(stored)]))
    if (factorOf(built[format]) !== factorOf(stored[format]))
      format_mix[format] = factorOf(stored[format]);
  return Object.keys(format_mix).length > 0 ? [{ op: "mix.set", format_mix }] : [];
}

/** The added sources' feeds by id, so an add reads as the address the suggestions offer. */
function feedsOf(files: ConfigFiles): Map<string, string> {
  const user = json(files["config/sources.user.json"]) as { added?: unknown } | null;
  const feeds = new Map<string, string>();
  for (const entry of Array.isArray(user?.added) ? user.added : []) {
    const { id, feed_url, url } = (entry ?? {}) as Record<string, unknown>;
    const address = typeof feed_url === "string" ? feed_url : typeof url === "string" ? url : null;
    if (typeof id === "string" && address) feeds.set(id, address);
  }
  return feeds;
}

function sketch(source: ManageSource, page: string): StoreSource {
  return {
    page,
    id: source.id,
    name: source.name,
    host: source.host,
    url: source.url,
    favicon_url: source.favicon_url,
    format: source.format,
    enabled: source.enabled,
    lean: source.lean,
    general: source.topic_ids.some((id) => isGeneralTopicId(id)),
  };
}

function sourceChanges(
  built: ManageData,
  stored: ManageData,
  feeds: Map<string, string>,
): StoreChanges {
  const ops: ConfigOp[] = [];
  const sources: StoreSource[] = [];
  const was = new Map(built.sources.map((source) => [source.id, source]));
  const builtPages = pagesOf(built);
  const storedPages = pagesOf(stored);
  for (const source of stored.sources) {
    const page = storedPages.get(source.id) ?? OTHER_ID;
    const before = was.get(source.id);
    if (!before) {
      const url = feeds.get(source.id) ?? source.url;
      if (url)
        ops.push({
          op: "source.add",
          url,
          id: source.id,
          ...(source.topic_ids.length > 0 ? { topic_ids: source.topic_ids } : {}),
        });
      // An add reads as on; one switched off since says so, for the counts as for its row.
      if (!source.enabled) ops.push({ op: "source.set", id: source.id, enabled: false });
      sources.push(sketch(source, page));
      continue;
    }
    if (before.enabled !== source.enabled)
      ops.push({ op: "source.set", id: source.id, enabled: source.enabled });
    const moved = (builtPages.get(source.id) ?? OTHER_ID) !== page;
    const update = {
      ...(before.name === source.name ? {} : { name: source.name }),
      ...(moved ? { topic_ids: source.topic_ids } : {}),
      ...(before.format === source.format ? {} : { format: source.format }),
      ...(before.lean === source.lean ? {} : { lean: source.lean }),
    };
    if (Object.keys(update).length > 0)
      ops.push({ op: "source.update", id: source.id, ...update } as ConfigOp);
    if (moved) sources.push(sketch(source, page));
  }
  const kept = new Set(stored.sources.map((source) => source.id));
  for (const source of built.sources)
    if (!kept.has(source.id)) ops.push({ op: "source.remove", id: source.id });
  return { ops, sources };
}

type ScheduleSet = Extract<ConfigOp, { op: "schedule.set" }>;

function scheduleOps(
  built: ScheduleView,
  stored: ScheduleView,
  topicIds: readonly string[],
): ConfigOp[] {
  const set: ScheduleSet = { op: "schedule.set" };
  if (built.timezone !== stored.timezone) set.timezone = stored.timezone;
  if (built.hour !== stored.hour) set.hour = stored.hour;
  if (built.cadenceDays !== stored.cadenceDays)
    set.cadence_days = stored.cadenceDays as ScheduleSet["cadence_days"];
  if (built.lengthMinutes !== stored.lengthMinutes)
    set.length_minutes = stored.lengthMinutes as ScheduleSet["length_minutes"];
  if (built.voiceId !== stored.voiceId) set.voice_id = stored.voiceId;
  if (built.voiceIdB !== stored.voiceIdB) set.voice_id_b = stored.voiceIdB;
  const weekly: NonNullable<ScheduleSet["weekly"]> = {};
  for (const key of [
    "enabled",
    "day",
    "hour",
    "format",
    "length_minutes",
    "voice_id",
    "voice_id_b",
  ] as const)
    if (built.weekly[key] !== stored.weekly[key])
      Object.assign(weekly, { [key]: stored.weekly[key] });
  if (Object.keys(weekly).length > 0) set.weekly = weekly;
  const custom: NonNullable<ScheduleSet["custom"]> = {};
  for (const key of ["format", "length_minutes"] as const)
    if (built.custom[key] !== stored.custom[key])
      Object.assign(custom, { [key]: stored.custom[key] });
  if (Object.keys(custom).length > 0) set.custom = custom;

  const ops: ConfigOp[] = Object.keys(set).length > 1 ? [set] : [];
  // Where topics play, as the scope chips read it: what each list now leaves out, or takes back.
  const lists = [
    ["daily", built.skipTopics, stored.skipTopics],
    ["weekly", built.weekly.skip_topics, stored.weekly.skip_topics],
    ["custom", built.custom.skip_topics, stored.custom.skip_topics],
  ] as const;
  // A chip stands for every topic it gathers and takes an edit only when one op covers all of them,
  // so a list that changed is sent whole: everything it leaves out, then everything it keeps.
  for (const [scope, before, after] of lists) {
    if (same([...before].sort(), [...after].sort())) continue;
    const kept = topicIds.filter((id) => !after.includes(id));
    if (after.length > 0) ops.push({ op: "topic.scope", ids: [...after], [scope]: false });
    if (kept.length > 0) ops.push({ op: "topic.scope", ids: kept, [scope]: true });
  }
  return ops;
}

function blockedOps(built: string[], stored: string[]): ConfigOp[] {
  return [
    ...stored
      .filter((domain) => !built.includes(domain))
      .map((domain): ConfigOp => ({ op: "profile.block", domain })),
    ...built
      .filter((domain) => !stored.includes(domain))
      .map((domain): ConfigOp => ({ op: "profile.unblock", domain })),
  ];
}

interface ConfigView {
  manage: ManageData;
  schedule: ScheduleView;
  blocked: string[];
}

interface BuiltView extends ConfigView {
  /** Which files they are (lib/configHash.ts), for the page to check against its own. */
  hash: string;
}

function viewOf(files: ConfigFiles): ConfigView {
  return {
    manage: manageOf(files),
    schedule: scheduleViewOf(json(files["config/schedule.json"])),
    blocked: blockedDomainsIn(json(files["config/profiles/owner.json"])),
  };
}

/** The build's side never changes within a deployment: laid out once per bundled set of files. */
const builtViews = new WeakMap<ConfigFiles, BuiltView>();

function builtView(built: ConfigFiles): BuiltView {
  let view = builtViews.get(built);
  if (!view) {
    view = { ...viewOf(built), hash: configHash(built) };
    builtViews.set(built, view);
  }
  return view;
}

/** The digest of the files the edits are a diff from (the build's), once per deployment. */
export function builtHash(built: ConfigFiles): string {
  return builtView(built).hash;
}

/**
 * The edits that turn the build's public files into the stored ones, and the sources a page must
 * draw because the build lists them nowhere or on another page. A file the store has no row for, or
 * a row that is not JSON, is the build's (as the engine treats it).
 */
export function storeChanges(built: ConfigFiles, storedRows: ConfigFiles): StoreChanges {
  const stored: Record<string, string | undefined> = { ...built };
  for (const [path, text] of Object.entries(storedRows))
    if (text !== undefined && json(text) !== null) stored[path] = text;
  const before = builtView(built);
  const after = viewOf(stored);
  const sources = sourceChanges(before.manage, after.manage, feedsOf(stored));
  return {
    ops: [
      ...topicOps(before.manage.topics, after.manage.topics),
      ...mixOps(before.manage.typeMix, after.manage.typeMix),
      ...sources.ops,
      ...scheduleOps(
        before.schedule,
        after.schedule,
        after.manage.topics.map((topic) => topic.id),
      ),
      ...blockedOps(before.blocked, after.blocked),
    ],
    sources: sources.sources,
  };
}
