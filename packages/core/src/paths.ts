import { execFileSync } from "node:child_process";
import { join } from "node:path";

/** Repository root, found with git so the engine never depends on absolute paths. */
export function repoRoot(cwd: string = process.cwd()): string {
  const out = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
  return out.trim();
}

/** Repo-relative path of a digest file: Digests/YYYY/MM/<id>.md */
export function digestRelPath(id: string): string {
  const [year, month] = id.split("-");
  return `Digests/${year}/${month}/${id}.md`;
}

/** Repo-relative path of a digest's audio timeline. */
export function audioTimelineRelPath(id: string): string {
  return digestRelPath(id).replace(/\.md$/, ".audio.json");
}

export const STATE_FILES = {
  seen: "state/seen.json",
  judgments: "state/judgments.json",
  lastRun: "state/last-run.json",
  usage: "state/usage.json",
  sourceHealth: "state/source-health.json",
  topicJudgments: "state/topic-judgments.json",
  sourceStats: "state/source-stats.json",
  sourceCandidates: "state/source-candidates.json",
} as const;

export const CONFIG_FILES = {
  preferences: "config/preferences.json",
  sources: "config/sources.json",
  sourcesUser: "config/sources.user.json",
  sourceCatalog: "config/source-catalog.json",
  generalFeeds: "config/general-feeds.json",
  topics: "config/topics.json",
  schedule: "config/schedule.json",
  writer: "config/writer.json",
  queries: "config/queries.json",
  voice: "config/voice.md",
} as const;

export function inRepo(root: string, rel: string): string {
  return join(root, rel);
}
