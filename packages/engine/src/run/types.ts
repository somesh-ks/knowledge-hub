import type { Category, CoverSpec, DigestKind, Outcome, SourceType } from "@dispatch/core";
import type { Logger } from "../context.js";
import type { ApiRuntime } from "../curate/apiRuntime.js";
import type { FirecrawlGuard } from "../fetch/firecrawlBudget.js";
import type { SourceFetcher } from "../fetch/types.js";
import type { RunMode } from "../gate/decideRun.js";
import type { GitRunner } from "../git/runGit.js";
import type { HttpClient } from "../http.js";
import type { SpendTotals, SpendTracker } from "./spend.js";

export type { RunMode };

/** Stage names are a contract with .github/workflows/run.yml: one workflow step per stage. */
export const STAGES = ["gate", "fetch", "judge", "write", "validate", "commit"] as const;
export type StageName = (typeof STAGES)[number];

export function isStageName(value: string): value is StageName {
  return (STAGES as readonly string[]).includes(value);
}

export interface RunOptions {
  mode: RunMode;
  /** Ignore the cadence gate. */
  force: boolean;
  /** Fetch window start for every pass, ISO date or time. */
  since: string | undefined;
  /** Run every stage but write nothing under state/ or Digests/ and commit nothing. */
  dryRun: boolean;
  /** Commit locally and skip the push. */
  noPush: boolean;
  /** One stage only, as a workflow step. Without it every stage runs in order. */
  stage: StageName | undefined;
  /** Write stage: what the owner asked to improve (Regenerate); reaches the writer prompt as untrusted text. */
  feedback: string | undefined;
  /** Commit stage only: adopt this run directory (agent mode) instead of the gate's plan. */
  run: string | undefined;
}

export const DEFAULT_RUN_OPTIONS: RunOptions = {
  mode: "scheduled",
  force: false,
  since: undefined,
  dryRun: false,
  noPush: false,
  stage: undefined,
  feedback: undefined,
  run: undefined,
};

/** What the cover package's pickCover accepts. Declared here so only buildDeps imports the package. */
export interface CoverPickInput {
  id: string;
  /** Stockholm calendar date, YYYY-MM-DD. */
  date: string;
  kind: DigestKind;
  lead_category?: Category | "watch";
  previous?: { template: string; palette: string };
}
export type CoverPickFn = (input: CoverPickInput) => CoverSpec;

/** Network access for the fetch stage. Tests replace the HTTP client or the fetchers. */
export interface FetchSetup {
  http: HttpClient;
  exaKey?: string | undefined;
  firecrawlKey?: string | undefined;
  /** Counts and limits Firecrawl requests for the run. Without it there is no ceiling (tests). */
  firecrawlGuard?: FirecrawlGuard | undefined;
  /**
   * False when there is no Jev key to judge the scoring sample (D70): its feed reads would be
   * thrown away, so the sample is not planned. Tests leave it out and get a sample.
   */
  sampleJudge?: boolean;
  /** Replace fetchers by source type, for tests. */
  fetchers?: Partial<Record<SourceType, SourceFetcher>>;
  /** Skips rate-limit waits in tests. */
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

/**
 * Everything the pipeline touches outside the repository files, injected so end-to-end tests run
 * with fakes and a real temporary git repository.
 */
export interface RunDeps {
  /** Absolute repository root. */
  root: string;
  now: () => Date;
  log: Logger;
  /** Secret values to keep out of any message that reaches a terminal or a job log. */
  secrets: readonly string[];
  fetch: FetchSetup;
  /**
   * Judge, writer, grounder and text extraction (with the Firecrawl scrape fallback inside).
   * Built on first use, so the gate, fetch and commit stages never need a model key.
   */
  runtime: () => Promise<ApiRuntime>;
  pickCover: CoverPickFn;
  git: GitRunner;
  /** Counts paid requests and holds the Firecrawl ceiling for the run. Absent in most tests. */
  spend?: SpendTracker;
}

/** One pass of a run, as the stages report it. */
export interface PassReport {
  id: string;
  kind: DigestKind;
  [detail: string]: unknown;
}

export interface StageReport {
  stage: Exclude<StageName, "gate" | "commit">;
  ok: true;
  dry_run: boolean;
  passes: PassReport[];
  /** Paid requests of the run so far, by service. */
  spend?: SpendTotals;
}

export interface GatePassReport {
  id: string;
  kind: DigestKind;
  window: { from: string; to: string };
}

/** The gate's JSON, read by the workflow: `due` decides whether the later steps run. */
export interface GateReport {
  due: boolean;
  reason: string;
  mode: RunMode;
  passes: GatePassReport[];
  dry_run: boolean;
}

export interface DigestReport {
  id: string;
  kind: DigestKind;
  outcome: Exclude<Outcome, "gated" | "failed">;
  items: number;
  verified: boolean;
  /** Repo-relative path of the digest file; null for a dry run or when nothing published. */
  path: string | null;
  /** Dry runs write the preview here, under .cache. */
  preview: string | null;
}

export type CommitStatus =
  | "nothing_to_commit"
  | "committed"
  | "pushed"
  | "dry_run"
  | "refused"
  | "push_failed";

/** The commit stage's JSON, read by the workflow: `outcome` and `deploy`. */
export interface CommitReport {
  outcome: Outcome;
  digests: DigestReport[];
  /** True when a digest published or any digest from the last 7 days still lacks audio. */
  deploy: boolean;
  /** Items across the digests published by this run. */
  items: number;
  dry_run: boolean;
  commit: { status: CommitStatus; sha?: string; message?: string; detail?: string };
  /** Why the run failed or was gated, in one sentence. */
  reason?: string;
  /** Paid requests the whole run made, by service. */
  spend?: SpendTotals;
}

/** A stage that exited non-zero. It carries the commit report's fields so the workflow's jq finds them. */
export interface FailureReport {
  outcome: "failed";
  stage: StageName;
  error: string;
  dry_run: boolean;
  digests: [];
  deploy: false;
  items: 0;
}

export interface PipelineResult {
  /** 0 for published, nothing and gated; 1 for a failed stage; 2 for a usage error. */
  code: number;
  /** The one JSON document the run prints on stdout. */
  report: GateReport | StageReport | CommitReport | FailureReport;
}
