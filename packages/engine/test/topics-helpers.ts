import { activeCustomTopics, type Preferences, resolveTopics, type Topic } from "@dispatch/core";

/** The topics of a repository that has never had one added: the resolved seed. */
export function loadTopicsFromSeed(preferences: Preferences): { custom: Topic[] } {
  return { custom: activeCustomTopics(resolveTopics(null, preferences)) };
}

// --- repositories and feeds -----------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadEnv } from "@dispatch/core";
import { type CommandContext, createLogger } from "../src/context.js";
import { makeSource } from "./fetch-helpers.js";
import { commitAll, createRepoPair, git, put, type RepoPair } from "./git-testRepo.js";
import { REPO_ROOT } from "./score-factories.js";

export interface ConfigRepo {
  pair: RepoPair;
  root: string;
  errors: string[];
  stdout: string[];
  context(json?: boolean): CommandContext;
  read(rel: string): Promise<string>;
  readJson<T = unknown>(rel: string): Promise<T>;
  /** Paths changed in the working tree, as `git status` lists them. */
  dirty(): string[];
  cleanup(): Promise<void>;
}

export const SEED_SOURCES = [
  makeSource({
    id: "alpha",
    name: "Alpha",
    url: "https://alpha.example/",
    feed_url: "https://alpha.example/feed.xml",
  }),
  makeSource({
    id: "beta",
    name: "Beta",
    url: "https://beta.example/",
    feed_url: "https://beta.example/feed.xml",
  }),
];

/** A clean clone holding the real preferences, a two-source registry and an empty query list. */
export async function configRepo(now = new Date("2026-10-07T06:00:00Z")): Promise<ConfigRepo> {
  const pair = await createRepoPair({ seedDigest: false });
  const root = pair.a;
  await put(
    root,
    "config/preferences.json",
    readFileSync(join(REPO_ROOT, "config", "preferences.json"), "utf8"),
  );
  await put(
    root,
    "config/sources.json",
    `${JSON.stringify({ version: 1, sources: SEED_SOURCES }, null, 2)}\n`,
  );
  await put(
    root,
    "config/queries.json",
    `${JSON.stringify({ version: 1, queries: [] }, null, 2)}\n`,
  );
  await commitAll(root, "chore: seed config");
  git(root, "push", "-q", "origin", "main");
  const errors: string[] = [];
  const stdout: string[] = [];
  return {
    pair,
    root,
    errors,
    stdout,
    context: (json = true) => ({
      root,
      env: loadEnv({}),
      log: createLogger({ json: false, secrets: [], write: (line) => errors.push(line) }),
      json,
      now: () => now,
    }),
    read: (rel) => readFile(join(root, rel), "utf8"),
    readJson: async <T = unknown>(rel: string) =>
      JSON.parse(await readFile(join(root, rel), "utf8")) as T,
    dirty: () =>
      git(root, "status", "--porcelain", "-uall")
        .split("\n")
        .filter(Boolean)
        .map((line) => line.replace(/^\s*\S+\s+/, "")),
    cleanup: () => pair.cleanup(),
  };
}

export interface FeedEntryInput {
  title: string;
  link: string;
  date: Date | null;
  summary?: string;
}

/** An RSS 2.0 document. A null date leaves the entry undated. */
export function rssFeed(title: string, entries: readonly FeedEntryInput[]): string {
  const items = entries
    .map(
      (entry) =>
        `<item><title>${entry.title}</title><link>${entry.link}</link>${
          entry.date ? `<pubDate>${entry.date.toUTCString()}</pubDate>` : ""
        }<description>${entry.summary ?? entry.title}</description></item>`,
    )
    .join("");
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title>${items}</channel></rss>`;
}

/** `count` entries on `host`, newest first, `everyDays` apart, the newest `ageDays` before `now`. */
export function datedEntries(
  host: string,
  count: number,
  now: Date,
  ageDays = 1,
  everyDays = 2,
  topicWord = "quantum",
): FeedEntryInput[] {
  return Array.from({ length: count }, (_, n) => ({
    title: `${topicWord} post ${n + 1} from ${host}`,
    link: `https://${host}/posts/${topicWord}-${n + 1}`,
    date: new Date(now.getTime() - (ageDays + n * everyDays) * 86_400_000),
  }));
}
