import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  type Category,
  type Digest,
  Item,
  itemId,
  type JudgmentEntry,
  type LastRunFile,
  parseDigestFile,
  type Source,
  serializeDigestFile,
} from "@dispatch/core";
import { pickCover } from "@dispatch/cover";
import type { Logger } from "../src/context.js";
import type { ApiRuntime } from "../src/curate/apiRuntime.js";
import type { PoolFile } from "../src/fetch/pool.js";
import { createGitRunner } from "../src/git/runGit.js";
import { createHttpClient } from "../src/http.js";
import type { Judge } from "../src/judge/types.js";
import { runPipeline } from "../src/run/pipeline.js";
import {
  DEFAULT_RUN_OPTIONS,
  type PipelineResult,
  type RunDeps,
  type RunOptions,
} from "../src/run/types.js";
import type { Grounder } from "../src/validate/grounding.js";
import { digestFor } from "./audio-fixtures.js";
import { type FakeWriter, fakeWriter, keywordGrounder, longText } from "./curate-helpers.js";
import { commitAll, git, put } from "./git-testRepo.js";
import { FIXTURE_CONFIG, makeEntry } from "./score-factories.js";
import { type CapturedLog, captureLog } from "./write-fakes.js";

/** Wednesday 7 October 2026, 07:13 in Stockholm. */
export const WED = new Date("2026-10-07T05:13:00Z");
/** Sunday 11 October 2026, 07:13 in Stockholm. */
export const SUN = new Date("2026-10-11T05:13:00Z");

const SOURCE_IDS = ["blog-a", "blog-b", "blog-c"] as const;

function source(id: string, tier: Source["tier"]): Source {
  return {
    id,
    name: `Source ${id}`,
    type: "rss",
    url: `https://${id}.example/`,
    feed_url: `https://${id}.example/feed.xml`,
    tier,
    high_signal: true,
    enabled: true,
    failures: 0,
    options: {},
  };
}

/** A consumer tech outlet: hinted, not high-signal, with the pool cap the registry gives it. */
export function techSource(id: string): Source {
  return {
    ...source(id, "daily"),
    high_signal: false,
    category_hint: "consumer_tech_releases",
    options: { pool_cap: "6" },
  };
}

/**
 * A launch story as one outlet headlined it. `launch` is the level (0 to 4) the test judge
 * answers for it; the headline is what story clustering compares.
 */
export function techItem(
  sourceId: string,
  slug: string,
  title: string,
  launch: number,
  publishedAt = "2026-10-06T08:00:00Z",
): Item {
  const url = `https://${sourceId}.example/${slug}`;
  return Item.parse({
    id: itemId(url),
    url,
    canonical_url: url,
    title,
    source_id: sourceId,
    source_type: "rss",
    published_at: publishedAt,
    fetched_at: "2026-10-07T05:00:00Z",
    snippet: `judge:consumer_tech_releases launch:${launch}`,
  });
}

/** Three daily sources and one weekly source; every item from a high-signal source passes the prefilter. */
export function sourcesFile(): { version: 1; sources: Source[] } {
  return {
    version: 1,
    sources: [...SOURCE_IDS.map((id) => source(id, "daily")), source("journal-w", "weekly")],
  };
}

const GOOD_CATEGORIES: Category[] = [
  "design_engineering_craft",
  "frontier_model_releases",
  "hci_empirical_research",
  "developer_tool_launches",
  "css_canvas_motion_techniques",
  "ai_ux_interaction_patterns",
];

export interface FeedItemOptions {
  sourceId: string;
  slug: string;
  /** What the judge answers for this item: a category, "none", or "skip" for no answer. */
  tag?: Category | "none" | "skip";
  publishedAt?: string;
}

/** A feed item whose snippet tells the test judge how to answer, so no model is needed. */
export function feedItem(options: FeedItemOptions): Item {
  const url = `https://${options.sourceId}.example/${options.slug}`;
  return Item.parse({
    id: itemId(url),
    url,
    canonical_url: url,
    title: `Post ${options.slug}`,
    source_id: options.sourceId,
    source_type: "rss",
    published_at: options.publishedAt ?? "2026-10-06T08:00:00Z",
    fetched_at: "2026-10-07T05:00:00Z",
    snippet: `judge:${options.tag ?? "design_engineering_craft"}`,
  });
}

/** `count` good items spread over the daily sources, with categories cycling for variety. */
export function goodFeeds(count: number, prefix = "good"): Record<string, Item[]> {
  const feeds: Record<string, Item[]> = {};
  for (let index = 0; index < count; index++) {
    const sourceId = SOURCE_IDS[index % SOURCE_IDS.length] as string;
    const item = feedItem({
      sourceId,
      slug: `${prefix}-${index + 1}`,
      tag: GOOD_CATEGORIES[index % GOOD_CATEGORIES.length] as Category,
    });
    feeds[sourceId] = [...(feeds[sourceId] ?? []), item];
  }
  return feeds;
}

/**
 * Answers from the snippet tag. Items tagged "skip" get no answer, as when a judge fails. A
 * `launch:<level>` tag sets the launch scale, which is what ranks a consumer tech item, and
 * `hype:<p>`, `sponsored:<p>` and `funding:<p>` set those flags (0 when absent).
 */
export class PatternJudge implements Judge {
  readonly name = "pattern";
  readonly model = "pattern-model";
  readonly questionsHash = "abc123def456";
  readonly asked: string[][] = [];
  private readonly now: () => Date;
  private readonly entryModel: string;

  constructor(now: () => Date, entryModel = "pattern-model") {
    this.now = now;
    this.entryModel = entryModel;
  }

  async judge(items: Item[]): Promise<JudgmentEntry[]> {
    this.asked.push(items.map((item) => item.id));
    const answers: JudgmentEntry[] = [];
    for (const item of items) {
      const tag = /judge:(\S+)/.exec(item.snippet)?.[1] ?? "none";
      if (tag === "skip") continue;
      const launch = /launch:(\d)/.exec(item.snippet)?.[1];
      const flag = (name: "hype" | "sponsored" | "funding"): number =>
        Number(new RegExp(`${name}:([0-9.]+)`).exec(item.snippet)?.[1] ?? 0);
      answers.push({
        ...makeEntry(item, {
          category: tag === "none" ? "none" : (tag as Category),
          p: 0.95,
          depth: 0.9,
          ...(launch === undefined ? {} : { launchScale: Number(launch) / 4 }),
          hype: flag("hype"),
          sponsored: flag("sponsored"),
          funding: flag("funding"),
          model: this.entryModel,
        }),
        questions_hash: this.questionsHash,
        judged_at: this.now().toISOString(),
      });
    }
    return answers;
  }
}

export interface FetchCall {
  source: string;
  from: string;
  to: string;
}

export interface World {
  deps: RunDeps;
  judge: PatternJudge;
  writer: FakeWriter;
  /** Items each source returns, by source id. Tests assign before running the fetch stage. */
  feeds: Record<string, Item[]>;
  fetchCalls: FetchCall[];
  logs: CapturedLog[];
  setNow(date: Date): void;
  /** Make the fetchers throw, as when the network is down. */
  breakNetwork(): void;
  /** Make one source fail while the others answer. */
  failSource(id: string): void;
}

export interface WorldOptions {
  now?: Date;
  feeds?: Record<string, Item[]>;
  /** Null means no grounding check (no Jev key). Defaults to a grounder that supports every sentence. */
  grounder?: Grounder | null;
  judge?: Judge;
  writer?: FakeWriter;
  extract?: ApiRuntime["extract"];
  /** Judges custom topics. Omitted means none, as when there is no Jev key. */
  topicJudge?: ApiRuntime["topicJudge"];
  /** Judges the general news stories. Omitted means none, as when there is no Jev key. */
  generalJudge?: ApiRuntime["generalJudge"];
}

/**
 * Real git, the real cover picker and the real stages, with every client replaced by a fake:
 * feeds come from `world.feeds`, the judge answers from snippet tags, the writer follows the
 * house voice, and nothing can reach the network.
 */
export function makeWorld(root: string, options: WorldOptions = {}): World {
  let current = options.now ?? WED;
  const now = (): Date => current;
  const { log, lines } = captureLog();
  const judge = new PatternJudge(now);
  const writer = options.writer ?? fakeWriter();
  const fetchCalls: FetchCall[] = [];
  let broken = false;
  const failing = new Set<string>();

  const world: World = {
    judge,
    writer,
    feeds: options.feeds ?? goodFeeds(8),
    fetchCalls,
    logs: lines,
    setNow: (date) => {
      current = date;
    },
    breakNetwork: () => {
      broken = true;
    },
    failSource: (id) => {
      failing.add(id);
    },
    deps: undefined as unknown as RunDeps,
  };
  const quiet: Logger = log;
  world.deps = {
    root,
    now,
    log: quiet,
    secrets: [],
    fetch: {
      http: createHttpClient({
        fetchImpl: async () => {
          throw new Error("network disabled in tests");
        },
        retries: 0,
      }),
      fetchers: {
        rss: async (src, window) => {
          fetchCalls.push({
            source: src.id,
            from: window.from.toISOString(),
            to: window.to.toISOString(),
          });
          if (broken || failing.has(src.id)) throw new Error("connection refused");
          return world.feeds[src.id] ?? [];
        },
      },
      sleep: async () => {},
    },
    runtime: async () => ({
      judge: options.judge ?? judge,
      writer,
      grounder: options.grounder === undefined ? keywordGrounder : options.grounder,
      ...(options.topicJudge === undefined ? {} : { topicJudge: options.topicJudge }),
      ...(options.generalJudge === undefined ? {} : { generalJudge: options.generalJudge }),
      // The scoring sample's Jev-only judge (D70); the test judge answers from snippet tags.
      sampleJudge: options.judge ?? judge,
      extract: options.extract ?? (async (item) => longText(item)),
      judgeFailures: [],
      usage: () => ({ tokens: 0, tokenLimit: 400_000 }),
    }),
    pickCover,
    git: createGitRunner(root),
  };
  return world;
}

export function options(overrides: Partial<RunOptions> = {}): RunOptions {
  return { ...DEFAULT_RUN_OPTIONS, ...overrides };
}

/** Run one stage (or everything) and return the result. */
export function runStage(
  world: World,
  overrides: Partial<RunOptions> = {},
): Promise<PipelineResult> {
  return runPipeline(world.deps, options(overrides));
}

/** Every stage as its own call, the way the workflow runs them. Stops at the first non-zero exit. */
export async function runStaged(
  world: World,
  overrides: Partial<RunOptions> = {},
): Promise<PipelineResult[]> {
  const results: PipelineResult[] = [];
  for (const stage of ["gate", "fetch", "judge", "write", "validate", "commit"] as const) {
    const result = await runStage(world, { ...overrides, stage });
    results.push(result);
    if (result.code !== 0) break;
    if (stage === "gate" && "due" in result.report && !result.report.due) {
      results.push(await runStage(world, { ...overrides, stage: "commit" }));
      break;
    }
  }
  return results;
}

// --- repositories --------------------------------------------------------------------------------

export interface TestRepo {
  /** Working clone the pipeline runs in. */
  root: string;
  /** A second clone, for another writer. */
  other: string;
  remote: string;
  cleanup(): Promise<void>;
}

/** Build the seed repository once; tests copy it instead of repeating a dozen git calls. */
export async function buildTemplate(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "dispatch-orch-tpl-"));
  const remote = join(base, "remote.git");
  const a = join(base, "a");
  const b = join(base, "b");
  git(base, "init", "-q", "--bare", "--initial-branch=main", remote);
  git(base, "clone", "-q", "-c", "core.autocrlf=false", remote, a);
  git(a, "checkout", "-q", "-b", "main");
  await put(a, ".gitignore", ".cache/\nnode_modules/\n.env\n");
  await put(a, "README.md", "# Test repository\n");
  for (const file of ["config/preferences.json", "config/voice.md"]) {
    await put(a, file, await readFile(join(FIXTURE_CONFIG, basename(file)), "utf8"));
  }
  await put(a, "config/sources.json", `${JSON.stringify(sourcesFile(), null, 2)}\n`);
  await put(a, "config/queries.json", '{ "version": 1, "queries": [] }\n');
  await commitAll(a, "chore: seed");
  git(a, "push", "-q", "-u", "origin", "main");
  git(base, "clone", "-q", "-c", "core.autocrlf=false", remote, b);
  return base;
}

export async function instantiate(template: string): Promise<TestRepo> {
  const base = await mkdtemp(join(tmpdir(), "dispatch-orch-"));
  await cp(template, base, { recursive: true });
  const remote = join(base, "remote.git");
  const root = join(base, "a");
  const other = join(base, "b");
  git(root, "remote", "set-url", "origin", remote);
  git(other, "remote", "set-url", "origin", remote);
  return {
    root,
    other,
    remote,
    cleanup: () => rm(base, { recursive: true, force: true, maxRetries: 3 }),
  };
}

/** Write and commit files, then push, so the tree stays clean as in a fresh checkout. */
export async function seed(
  root: string,
  files: Record<string, string>,
  message = "chore: seed state",
): Promise<void> {
  for (const [path, content] of Object.entries(files)) await put(root, path, content);
  await commitAll(root, message);
  git(root, "push", "-q", "origin", "main");
}

export const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export function lastRunFile(file: Omit<LastRunFile, "version">): string {
  return json({ version: 1, ...file });
}

export async function readJson<T = unknown>(root: string, rel: string): Promise<T> {
  return JSON.parse(await readFile(join(root, rel), "utf8")) as T;
}

export async function readDigest(root: string, rel: string): Promise<Digest> {
  return parseDigestFile(await readFile(join(root, rel), "utf8"));
}

export async function exists(root: string, rel: string): Promise<boolean> {
  try {
    await readFile(join(root, rel));
    return true;
  } catch {
    return false;
  }
}

/** A digest file for a past day with no audio, as the deploy retry path sees it. */
export function digestFile(id: string, audio: Digest["audio"] = null): string {
  return serializeDigestFile({ ...digestFor(id), audio });
}

export async function overwrite(root: string, rel: string, content: string): Promise<void> {
  await writeFile(join(root, rel), content, "utf8");
}

/** Items for one source, categories cycling, slugs `${prefix}-1` and up. */
export function sourceItems(sourceId: string, count: number, prefix: string): Item[] {
  return Array.from({ length: count }, (_, index) =>
    feedItem({
      sourceId,
      slug: `${prefix}-${index + 1}`,
      tag: GOOD_CATEGORIES[index % GOOD_CATEGORIES.length] as Category,
    }),
  );
}

export function head(cwd: string): string {
  return git(cwd, "rev-parse", "HEAD");
}

/** A pool file as `dispatch fetch` writes it, for tests that start from a pool. */
export function poolFile(
  id: string,
  items: readonly Item[],
  kind: PoolFile["kind"] = "regular",
): PoolFile {
  return {
    version: 1,
    id,
    kind,
    generated_at: WED.toISOString(),
    window: { from: "2026-10-05T05:13:00.000Z", to: WED.toISOString() },
    sources: [],
    report: {
      fetched: items.length,
      dedupe: {
        input: items.length,
        already_seen: 0,
        same_url: 0,
        newsletter_collapsed: 0,
        near_duplicate: 0,
        story_clustered: 0,
        output: items.length,
      },
      prefilter: {
        input: items.length,
        kept: items.length,
        dropped: { disliked: 0, not_relevant: 0, source_cap: 0, cap: 0 },
        tech: { input: 0, kept: 0, source_cap: 0, cap: 0 },
        trending: { input: 0, single_outlet: 0, kept: 0, source_cap: 0, cap: 0 },
      },
    },
    items: [...items],
  };
}

/** Dependencies for stages that touch only files: every client throws if used. */
export function bareDeps(root: string, now: Date, secrets: readonly string[] = []): RunDeps {
  const unused = (): never => {
    throw new Error("this stage must not use a client");
  };
  return {
    root,
    now: () => now,
    log: captureLog().log,
    secrets,
    fetch: { http: { fetchText: unused, getJson: unused, postJson: unused } },
    runtime: unused,
    pickCover: unused,
    git: unused,
  };
}
