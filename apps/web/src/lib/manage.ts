import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CATEGORIES, homeSection, NEVER_PUBLISH, SECTION_TITLES, SECTIONS } from "@dispatch/core";
import { findRepoRoot } from "./repoRoot";
import { usesFixtures } from "./site";

/**
 * What the Topics and Sources pages show, read from the repository at build time. The engine writes
 * these files and some may not exist yet, so every read is defensive: a missing or malformed file
 * falls back to what the site can know without it, and a malformed entry is skipped, never guessed.
 *
 * Build time only. The pages' script imports nothing from here.
 */

// ------------------------------------------------------------------------------------------ types

export type TopicOrigin = "builtin" | "custom";

export interface ManageSection {
  id: string;
  title: string;
  order: number;
}

export interface ManageTopic {
  id: string;
  name: string;
  description: string;
  /** 0 to 1, as stored. */
  weight: number;
  /** Where `weight` sits on the five-step control, 0 to 4. */
  step: number;
  enabled: boolean;
  keywords: string[];
  section_id: string;
  never_publish: boolean;
  origin: TopicOrigin;
}

export interface ManageSource {
  id: string;
  name: string;
  host: string;
  enabled: boolean;
  pinned: boolean;
  /** "12 of 40 stories made a briefing", or null when there is no record yet. */
  record: string | null;
  /** True when the source has failed to load several times in a row. */
  struggling: boolean;
  /** Lowercase text the search matches. */
  search: string;
}

export interface ManageCandidate {
  /** The address the add operation sends. */
  feed_url: string;
  domain: string;
  /** "Strong match" and so on. */
  quality: string;
  /** "Strong match for Motion craft, from 8 recent stories". */
  detail: string;
  topic_id: string;
  search: string;
}

export interface ManageData {
  topics: ManageTopic[];
  sections: ManageSection[];
  /** Where a topic made on the page goes until the engine places it better. */
  defaultSectionId: string;
  sources: ManageSource[];
  candidates: ManageCandidate[];
}

// -------------------------------------------------------------------------------- words and numbers

export const WEIGHT_STEPS = ["Less", "A bit less", "Normal", "A bit more", "More"] as const;
export const WEIGHT_STEP_MAX = WEIGHT_STEPS.length - 1;

/** The nearest of the five steps for a stored weight. */
export function weightToStep(weight: number): number {
  const step = Math.round(Math.min(1, Math.max(0, weight)) * WEIGHT_STEP_MAX);
  return Number.isFinite(step) ? step : Math.round(WEIGHT_STEP_MAX / 2);
}

/** The stored weight for a step. The page's script uses the same sum. */
export function stepToWeight(step: number): number {
  return Math.min(WEIGHT_STEP_MAX, Math.max(0, step)) / WEIGHT_STEP_MAX;
}

/** A host without its leading "www.", or an empty string when the address is not a web address. */
export function hostOf(address: string | null | undefined): string {
  if (!address) return "";
  try {
    return new URL(address).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export interface SourceStats {
  fetched: number;
  judged: number;
  passed: number;
  published: number;
}

/**
 * The record in words. The share is out of the stories that were judged, which is every story that
 * had a real chance, and out of those fetched when the engine has not counted judging yet.
 */
export function recordInWords(stats: SourceStats | null | undefined): string | null {
  if (!stats) return null;
  const total = stats.judged > 0 ? stats.judged : stats.fetched;
  if (total <= 0) return null;
  const published = Math.min(stats.published, total);
  if (published <= 0) {
    return total === 1
      ? "The 1 story did not make a briefing"
      : `None of ${total} stories made a briefing`;
  }
  return `${published} of ${total} ${total === 1 ? "story" : "stories"} made a briefing`;
}

/** A candidate's quality figure, 0 to 1 (or 0 to 100), as a phrase. */
export function qualityInWords(quality: number): string {
  const share = quality > 1 ? quality / 100 : quality;
  if (share >= 0.75) return "Strong match";
  if (share >= 0.5) return "Good match";
  if (share >= 0.25) return "Fair match";
  return "Weak match";
}

/** A source that has failed this many runs in a row is flagged on its row. */
export const STRUGGLING_FAILURES = 3;

// ------------------------------------------------------------------------------------ safe reading

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const asBool = (value: unknown, otherwise: boolean): boolean =>
  typeof value === "boolean" ? value : otherwise;

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/** "design_engineering_craft" as "Design engineering craft". */
export function humanize(id: string): string {
  const words = id.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ------------------------------------------------------------------------------------------ topics

/** What each built-in category means, for the page that lists them before the engine's file exists. */
const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  design_engineering_craft: "How an interface detail was built, with the technique shown.",
  hci_empirical_research: "Interaction research with a method and results.",
  ui_component_primitives: "Accessible components, primitives and design tokens.",
  ai_ux_interaction_patterns: "Interface patterns for chat, agents and generative UI.",
  css_canvas_motion_techniques: "CSS, canvas, shader and animation techniques with a demo.",
  frontier_model_releases: "Releases, model cards and benchmarks for frontier AI models.",
  developer_tool_launches:
    "Launches of tools, frameworks and libraries a design engineer might use.",
  taste_and_design_philosophy: "Essays and talks on taste, craft and design principles.",
  venture_capital_and_gossip: "Funding rounds, valuations and industry gossip.",
  generic_ai_hype_listicles: "Generic AI hype and top-ten tool lists.",
  consumer_tech_releases: "Phones, laptops, wearables and the software that ships on them.",
};

function readWeights(preferences: unknown): Record<string, number> {
  const weights = isRecord(preferences) && isRecord(preferences.weights) ? preferences.weights : {};
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(weights)) {
    const weight = asNumber(value);
    if (weight !== null) result[key] = weight;
  }
  return result;
}

/** The built-in topics, from the categories the engine already judges by and the stored weights. */
export function fallbackTopics(preferences: unknown): ManageTopic[] {
  const weights = readWeights(preferences);
  return CATEGORIES.map((id) => {
    const weight = weights[id] ?? 0.5;
    return {
      id,
      name: humanize(id),
      description: CATEGORY_DESCRIPTIONS[id] ?? "",
      weight,
      step: weightToStep(weight),
      enabled: true,
      keywords: [],
      section_id: homeSection(id, "rss") ?? "top",
      never_publish: NEVER_PUBLISH.includes(id),
      origin: "builtin",
    };
  });
}

export function fallbackSections(): ManageSection[] {
  return SECTIONS.map((id, order) => ({ id, title: SECTION_TITLES[id], order }));
}

function parseTopic(value: unknown): ManageTopic | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const name = asString(value.name);
  if (!id || !name) return null;
  const weight = Math.min(1, Math.max(0, asNumber(value.weight) ?? 0.5));
  const keywords = Array.isArray(value.keywords)
    ? value.keywords.map(asString).filter((word): word is string => word !== null)
    : [];
  return {
    id,
    name,
    description: asString(value.description) ?? "",
    weight,
    step: weightToStep(weight),
    enabled: asBool(value.enabled, true),
    keywords,
    section_id: asString(value.section_id) ?? "top",
    never_publish: asBool(value.never_publish, false),
    origin: value.origin === "custom" ? "custom" : "builtin",
  };
}

/** Topics and sections from config/topics.json, or null when the file is missing or has no topics. */
export function parseTopicsFile(
  file: unknown,
): { topics: ManageTopic[]; sections: ManageSection[] } | null {
  if (!isRecord(file) || !Array.isArray(file.topics)) return null;
  const topics = file.topics
    .map(parseTopic)
    .filter((topic): topic is ManageTopic => topic !== null);
  if (topics.length === 0) return null;
  const sections = (Array.isArray(file.sections) ? file.sections : [])
    .map((entry, index): ManageSection | null => {
      if (!isRecord(entry)) return null;
      const id = asString(entry.id);
      const title = asString(entry.title);
      return id && title ? { id, title, order: asNumber(entry.order) ?? index } : null;
    })
    .filter((section): section is ManageSection => section !== null)
    .sort((a, b) => a.order - b.order);
  return { topics, sections: sections.length > 0 ? sections : fallbackSections() };
}

/** The section a topic made on the page goes in: Tech releases when there is one, else the last. */
export function pickDefaultSection(sections: readonly ManageSection[]): string {
  return sections.find((section) => section.id === "tech")?.id ?? sections.at(-1)?.id ?? "tech";
}

// ----------------------------------------------------------------------------------------- sources

interface RawSource {
  id: string;
  name: string;
  url: string | null;
  feed_url: string | null;
  enabled: boolean;
  failures: number;
}

function parseSource(value: unknown): RawSource | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  if (!id) return null;
  const url = asString(value.url);
  const feed = asString(value.feed_url);
  return {
    id,
    name: asString(value.name) ?? id,
    url,
    feed_url: feed,
    enabled: asBool(value.enabled, true),
    failures: asNumber(value.failures) ?? 0,
  };
}

function parseSources(file: unknown): RawSource[] {
  const list = isRecord(file) && Array.isArray(file.sources) ? file.sources : [];
  return list.map(parseSource).filter((source): source is RawSource => source !== null);
}

interface Override {
  enabled?: boolean;
  pinned?: boolean;
  removed?: boolean;
}

function parseOverrides(file: unknown): { added: RawSource[]; overrides: Map<string, Override> } {
  const added =
    isRecord(file) && Array.isArray(file.added) ? parseSources({ sources: file.added }) : [];
  const overrides = new Map<string, Override>();
  if (isRecord(file) && isRecord(file.overrides)) {
    for (const [id, entry] of Object.entries(file.overrides)) {
      if (!isRecord(entry)) continue;
      overrides.set(id, {
        ...(typeof entry.enabled === "boolean" ? { enabled: entry.enabled } : {}),
        ...(typeof entry.pinned === "boolean" ? { pinned: entry.pinned } : {}),
        ...(typeof entry.removed === "boolean" ? { removed: entry.removed } : {}),
      });
    }
  }
  return { added, overrides };
}

function parseStats(file: unknown): Map<string, SourceStats> {
  const result = new Map<string, SourceStats>();
  if (!isRecord(file) || !isRecord(file.sources)) return result;
  for (const [id, entry] of Object.entries(file.sources)) {
    if (!isRecord(entry)) continue;
    result.set(id, {
      fetched: asNumber(entry.fetched) ?? 0,
      judged: asNumber(entry.judged) ?? 0,
      passed: asNumber(entry.passed) ?? 0,
      published: asNumber(entry.published) ?? 0,
    });
  }
  return result;
}

function parseHealth(file: unknown): Map<string, number> {
  const result = new Map<string, number>();
  if (!isRecord(file) || !isRecord(file.sources)) return result;
  for (const [id, entry] of Object.entries(file.sources)) {
    if (isRecord(entry)) result.set(id, asNumber(entry.failures) ?? 0);
  }
  return result;
}

/**
 * The sources as rows: the registry plus the ones added on the site, with the owner's overrides
 * applied and removed ones left out. Pinned first, then by name.
 */
export function buildSources(input: {
  registry: unknown;
  user: unknown;
  stats: unknown;
  health: unknown;
}): ManageSource[] {
  const { added, overrides } = parseOverrides(input.user);
  const stats = parseStats(input.stats);
  const health = parseHealth(input.health);
  const seen = new Set<string>();
  const rows: ManageSource[] = [];

  for (const source of [...parseSources(input.registry), ...added]) {
    if (seen.has(source.id)) continue;
    seen.add(source.id);
    const override = overrides.get(source.id) ?? {};
    if (override.removed) continue;
    const host = hostOf(source.url) || hostOf(source.feed_url);
    const failures = Math.max(source.failures, health.get(source.id) ?? 0);
    rows.push({
      id: source.id,
      name: source.name,
      host,
      enabled: override.enabled ?? source.enabled,
      pinned: override.pinned ?? false,
      record: recordInWords(stats.get(source.id)),
      struggling: failures >= STRUGGLING_FAILURES,
      search: `${source.name} ${host} ${source.id}`.toLowerCase(),
    });
  }
  return rows.sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name, "en"),
  );
}

/** Feed addresses compare without a trailing slash or a scheme's case. */
function sameFeed(a: string, b: string): boolean {
  return a.replace(/\/+$/, "").toLowerCase() === b.replace(/\/+$/, "").toLowerCase();
}

/** Suggestions from state/source-candidates.json, best first, leaving out feeds already in the list. */
export function buildCandidates(
  file: unknown,
  topics: readonly ManageTopic[],
  knownFeeds: readonly string[],
): ManageCandidate[] {
  if (!isRecord(file)) return [];
  // The engine writes one entry per topic: { topics: { <topic id>: { candidates: [...] } } }.
  const groups: { topicId: string; entries: unknown[] }[] = [];
  if (isRecord(file.topics)) {
    for (const [topicId, group] of Object.entries(file.topics)) {
      if (isRecord(group) && Array.isArray(group.candidates)) {
        groups.push({ topicId, entries: group.candidates });
      }
    }
  } else if (Array.isArray(file.candidates)) {
    groups.push({ topicId: asString(file.topic_id) ?? "", entries: file.candidates });
  }
  const rows: { quality: number; candidate: ManageCandidate }[] = [];
  const taken = [...knownFeeds];

  for (const { topicId, entries } of groups)
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      // A candidate the engine already added is in the list above; one it rejected has no working feed.
      const status = asString(entry.status);
      if (status === "added" || status === "rejected") continue;
      const topicName = topics.find((topic) => topic.id === topicId)?.name ?? null;
      const feed = asString(entry.feed_url);
      if (!feed || !hostOf(feed) || taken.some((known) => sameFeed(known, feed))) continue;
      taken.push(feed);
      const domain = asString(entry.domain) ?? asString(entry.name) ?? hostOf(feed);
      const quality = asNumber(entry.q) ?? 0;
      const words = qualityInWords(quality);
      const samples = asNumber(entry.recent_entries) ?? asNumber(entry.sample_n);
      const basis =
        samples !== null && samples > 0
          ? `, from ${samples} recent ${samples === 1 ? "story" : "stories"}`
          : "";
      rows.push({
        quality,
        candidate: {
          feed_url: feed,
          domain,
          quality: words,
          detail: `${words}${topicName ? ` for ${topicName}` : ""}${basis}`,
          topic_id: topicId,
          search: `${domain} ${topicName ?? ""}`.toLowerCase(),
        },
      });
    }
  return rows.sort((a, b) => b.quality - a.quality).map((row) => row.candidate);
}

// ------------------------------------------------------------------------------------------ loader

export interface LoadManageOptions {
  root?: string;
  env?: Record<string, string | undefined>;
}

/**
 * Reads everything under `root`: config/ and state/. With DISPATCH_FIXTURES=1 the root is the invented
 * fixtures, so a production build can never show them.
 */
export async function loadManage(options: LoadManageOptions = {}): Promise<ManageData> {
  const env = options.env ?? process.env;
  const repo = options.root ?? findRepoRoot(process.cwd(), env);
  const base = usesFixtures(env) ? join(repo, "apps", "web", "src", "fixtures") : repo;
  const [topicsFile, preferences, registry, user, stats, health, candidates] = await Promise.all([
    readJson(join(base, "config", "topics.json")),
    readJson(join(base, "config", "preferences.json")),
    readJson(join(base, "config", "sources.json")),
    readJson(join(base, "config", "sources.user.json")),
    readJson(join(base, "state", "source-stats.json")),
    readJson(join(base, "state", "source-health.json")),
    readJson(join(base, "state", "source-candidates.json")),
  ]);

  const parsed = parseTopicsFile(topicsFile);
  const topics = parsed?.topics ?? fallbackTopics(preferences);
  const sections = parsed?.sections ?? fallbackSections();
  const sources = buildSources({ registry, user, stats, health });

  const knownFeeds = [...parseSources(registry), ...parseOverrides(user).added].flatMap((source) =>
    [source.feed_url, source.url].filter((address): address is string => address !== null),
  );
  return {
    topics,
    sections,
    defaultSectionId: pickDefaultSection(sections),
    sources,
    candidates: buildCandidates(candidates, topics, knownFeeds),
  };
}
