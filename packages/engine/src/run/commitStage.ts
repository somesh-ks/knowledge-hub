import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  type Digest,
  digestRelPath,
  type Outcome,
  type Source,
  serializeDigestFile,
  stockholmDate,
  VOICE_LIMITS,
  withGeneralTopics,
} from "@singularity/core";
import {
  linkSourceIds,
  loadJudgments,
  loadSources,
  type ParsedPool,
  readJsonIfExists,
  sourceNameMap,
} from "../curate/inputs.js";
import { Selection } from "../curate/selectionFile.js";
import { type CommitOutcome, commandAllowlist, commitAndPush } from "../git/commit.js";
import { fastForwardToRemote } from "../git/fastForward.js";
import { findViolations, readChangedPaths } from "../git/guard.js";
import { pruneTopicJudgments } from "../judge/topicJudge.js";
import { recordRunMetrics } from "../metrics/runMetrics.js";
import { createIdAllocator, listTakenIds } from "../render/digestId.js";
import { writeDigestFile } from "../render/writeDigestFile.js";
import { loadSectionPlan } from "../score/sectionPlan.js";
import { markSeen, pruneJudgments, pruneSeen } from "../state/prune.js";
import { recordRun } from "../state/runRecord.js";
import { recordSourceStats, type SourceCounts } from "../state/sourceStats.js";
import {
  readLastRun,
  readSeen,
  readSourceStats,
  readTopicJudgments,
  writeJudgments,
  writeLastRun,
  writeSeen,
  writeSourceStats,
  writeTopicJudgments,
} from "../state/store.js";
import { markCopiedFromStore, syncedWithStore } from "../store/configDocs.js";
import { CONFIG_DOCUMENT_PATHS } from "../store/configPaths.js";
import { loadTopicsFile } from "../topics/store.js";
import { validateDigest } from "../validate/validateDigest.js";
import { createLinter } from "../voice/lint.js";
import { loadVoice } from "../voice/voice.js";
import { withRunJudgments, withRunTopicJudgments } from "./artifacts.js";
import { collectRunMetrics } from "./collectMetrics.js";
import { makeCoverPicker } from "./cover.js";
import { digestFromSelection } from "./digestFromSelection.js";
import { StageFailure } from "./errors.js";
import { loadPassPool } from "./passPool.js";
import { DEPLOY_AUDIO_WINDOW_DAYS, digestsLackingAudio } from "./pendingAudio.js";
import {
  type Plan,
  type PlanPass,
  passFile,
  requireStage,
  runJudgmentsPath,
  runTopicJudgmentsPath,
  writePlan,
} from "./plan.js";
import { nextRegenerations, removeDigestFiles } from "./replace.js";
import { markAdoptedCommitted, resolveCommitPlan } from "./resolveCommitPlan.js";
import { readSourceCounts } from "./sourceCounts.js";
import { recordSpend } from "./spend.js";
import type { CommitReport, DigestReport, RunDeps, RunOptions } from "./types.js";

const CONFIG_PATHS: ReadonlySet<string> = new Set(CONFIG_DOCUMENT_PATHS);

/** What the commit stage reads for one pass. */
interface PassData {
  pass: PlanPass;
  selection: Selection;
  pool: ParsedPool;
  /** Per-source fetched, judged and passed counts the write stage recorded; null when absent. */
  sourceCounts: Record<string, SourceCounts> | null;
}

async function loadPassData(deps: RunDeps, plan: Plan, pass: PlanPass): Promise<PassData> {
  // A gate plan must have been through every stage. An adopted agent run was validated by curate.
  if (plan.source === "gate") await requireStage(deps.root, pass, "validate", "committing");
  const raw = await readJsonIfExists(
    passFile(deps.root, pass.id, "selection.json"),
    "selection.json",
  );
  const selection = Selection.safeParse(raw);
  if (!selection.success) {
    throw new StageFailure(
      `${pass.id}: selection.json is missing or invalid. Run the earlier stages.`,
    );
  }
  const pool = await loadPassPool(
    passFile(deps.root, pass.id, "pool.json"),
    passFile(deps.root, pass.id, "general.json"),
  );
  return {
    pass,
    selection: selection.data,
    pool,
    sourceCounts: await readSourceCounts(passFile(deps.root, pass.id, "source-counts.json")),
  };
}

function describeCommit(outcome: CommitOutcome): CommitReport["commit"] {
  switch (outcome.status) {
    case "nothing_to_commit":
      return { status: "nothing_to_commit" };
    case "committed":
      return { status: "committed", sha: outcome.sha };
    case "pushed":
      return { status: "pushed", sha: outcome.sha };
    case "refused":
      return { status: "refused", detail: `${outcome.reason}: ${outcome.offending.join(", ")}` };
    case "push_failed":
      return {
        status: "push_failed",
        sha: outcome.sha,
        detail: `${outcome.reason}: ${outcome.detail}`,
      };
    default: {
      const unreachable: never = outcome;
      throw new Error(`Unhandled commit outcome ${JSON.stringify(unreachable)}`);
    }
  }
}

function failedReport(
  dryRun: boolean,
  reason: string,
  commit: CommitReport["commit"],
  digests: DigestReport[] = [],
): CommitReport {
  return { outcome: "failed", digests, deploy: false, items: 0, dry_run: dryRun, commit, reason };
}

/** The longest a run waits for its publish time: more than that and it publishes now. */
export const MAX_HOLD_MS = 135 * 60_000;

/** Waits until the plan's publish time when it is ahead, within MAX_HOLD_MS. True when it waited. */
export async function holdUntilPublishTime(deps: RunDeps, plan: Plan): Promise<boolean> {
  if (plan.publish_at === undefined) return false;
  const ms = Date.parse(plan.publish_at) - deps.now().getTime();
  if (ms <= 0 || ms > MAX_HOLD_MS) return false;
  deps.log.info("Generated ahead; holding until the scheduled time", {
    publish_at: plan.publish_at,
  });
  await (deps.wait ?? ((wait) => new Promise<void>((resolve) => setTimeout(resolve, wait))))(ms);
  return true;
}

/**
 * Persist the run. Digests are built from each pass's validated selection, with the cover from
 * the cover package (avoiding the previous cover), and written without ever overwriting. Then
 * state/seen.json (the items the briefings show), state/judgments.json (merged,
 * pruned), state/last-run.json (the record for each pass's kind, the fetch window and the last
 * cover) and the pruned seen list are written, the write guard checks the tree, and one commit
 * is made and pushed with a rebase retry.
 *
 * Outcomes: "published" when any pass published, else "nothing", else "gated" (no pass was
 * planned). A failure anywhere before the files are written leaves state untouched. A dry run
 * commits only its spend to the cost ledger; digests are only previewed under .cache.
 */
export async function commitStage(deps: RunDeps, options: RunOptions): Promise<CommitReport> {
  const { root } = deps;
  const { plan, adopted } = await resolveCommitPlan(deps, options);
  const dryRun = plan.dry_run || options.dryRun;

  if (plan.passes.length === 0) return commitGated(deps, options, plan, dryRun);

  // Generation is done. A run that started ahead holds here until its scheduled time; one that
  // started late publishes at once. The record keeps both instants (D193).
  const generatedAt = deps.now().toISOString();
  // Config is read before the wait: the selection was validated against it, and a category muted
  // or a voice edited meanwhile must not fail a finished briefing (D209).
  const sources: Source[] = await loadSources(root);
  const linter = createLinter(await loadVoice(root));
  const topics = withGeneralTopics(await loadTopicsFile(root));
  const sectionPlans = new Map<string, Awaited<ReturnType<typeof loadSectionPlan>>>();
  for (const pass of plan.passes) {
    sectionPlans.set(pass.id, await loadSectionPlan(root, pass.kind, plan.length_minutes));
  }
  const held = !dryRun && !adopted && (await holdUntilPublishTime(deps, plan));
  // State and Digests are read after it, from the remote's branch and not the checkout from job
  // start (D209).
  if (held && !options.noPush) {
    const forwarded = await fastForwardToRemote(deps.git, deps.log);
    // A config edit that came in from the repo means the files are no longer the store's, so the
    // commit must not claim to be a snapshot of it: the next gate would read the store's older copy
    // as the newer one and revert the edit (D209).
    const configMayHaveChanged =
      forwarded.changed === null || forwarded.changed.some((path) => CONFIG_PATHS.has(path));
    if (configMayHaveChanged && (await syncedWithStore(root))) {
      await markCopiedFromStore(root, true, false);
    }
  }
  const now = deps.now();

  // An adopted agent run made no model or Firecrawl calls through the stages, so it records none.
  if (!adopted) await deps.spend?.begin(root, plan.created_at, deps.log);
  const spend = adopted ? undefined : deps.spend?.totals();

  const passData: PassData[] = [];
  for (const pass of plan.passes) passData.push(await loadPassData(deps, plan, pass));

  const today = stockholmDate(now);
  const nowIso = now.toISOString();
  const sourceNames = sourceNameMap(sources);
  let lastRun = await readLastRun(root);
  let seen = await readSeen(root);
  let judgments = await withRunJudgments(await loadJudgments(root), runJudgmentsPath(root));
  let topicJudgments = await withRunTopicJudgments(
    await readTopicJudgments(root),
    runTopicJudgmentsPath(root),
  );
  let sourceStats = await readSourceStats(root);
  let statsTouched = false;

  const taken = new Set<string>();
  for (const date of new Set(plan.passes.map((pass) => pass.id.slice(0, 10)))) {
    for (const id of await listTakenIds(root, date)) taken.add(id);
  }

  // A replacement keeps the old digest's id: it is free once the old files go, in the same commit.
  const replaces = plan.replaces;
  if (replaces !== undefined) taken.delete(replaces);

  const digests: Digest[] = [];
  const reports: DigestReport[] = [];
  for (const data of passData) {
    const { pass, selection, pool, sourceCounts } = data;
    // A replacement is not a run of the cadence: it is recorded as an on-demand run (the status
    // route reads that slot for the Generate sheet) and leaves the fetch window where it was.
    const recordKind = replaces === undefined ? pass.kind : "on-demand";
    const recordWindow = replaces === undefined ? new Date(selection.window.to) : undefined;
    if (selection.outcome === "nothing" || selection.items.length === 0) {
      lastRun = recordRun(lastRun, {
        kind: recordKind,
        record: { at: nowIso, outcome: "nothing", items: 0, generated_at: generatedAt },
        fetchedThrough: recordWindow,
      });
      if (sourceCounts) {
        sourceStats = recordSourceStats(sourceStats, sourceCounts, [], today);
        statsTouched = true;
      }
      reports.push({
        id: pass.id,
        kind: pass.kind,
        outcome: "nothing",
        items: 0,
        verified: false,
        path: null,
        preview: null,
      });
      continue;
    }

    const sectionPlan = sectionPlans.get(pass.id);
    const digest = digestFromSelection({
      selection,
      pool: pool.items,
      sourceNames,
      linkSources: linkSourceIds(sources),
      now,
      coverPicker: makeCoverPicker(deps.pickCover, lastRun.last_cover),
      allocateId: createIdAllocator(taken, pass.id),
      // Nothing an agent session wrote counts as grounded, whatever the file claims.
      verified: selection.mode === "agent" ? false : selection.verified,
      topics,
      plan: sectionPlan,
      ...(replaces === undefined ? {} : { regenerations: await nextRegenerations(root, replaces) }),
    });
    const report = validateDigest(digest, {
      pool: pool.items,
      sources,
      linter,
      topics,
      plan: sectionPlan,
      // The engine's selection already held the pass to its length; an agent's is held to the
      // kind's cap here as it was when the agent wrote it.
      ...(selection.mode === "agent" ? {} : { cap: VOICE_LIMITS.items.hardMax }),
    });
    if (!report.ok) {
      const first = report.issues.find((issue) => issue.severity === "error");
      throw new StageFailure(
        `${pass.id}: the digest failed validation with ${report.errors} errors, nothing was written${first ? ` (${first.message})` : ""}`,
      );
    }
    digests.push(digest);
    lastRun = recordRun(lastRun, {
      kind: recordKind,
      record: {
        at: nowIso,
        outcome: "published",
        digest_id: digest.id,
        items: digest.items.length,
        generated_at: generatedAt,
      },
      fetchedThrough: recordWindow,
    });
    lastRun = {
      ...lastRun,
      last_cover: { template: digest.cover.template, palette: digest.cover.palette },
    };
    // Only what the briefing shows is seen. An item judged but cut (by the cap, the bar or a
    // "nothing" run) stays eligible: if a later pass fetches it again, its judgment comes from
    // state/judgments.json (30 days), so it is reconsidered without being judged twice.
    seen = markSeen(
      seen,
      digest.items.map((item) => item.id),
      today,
    );
    if (sourceCounts) {
      const bySource = new Map(pool.items.map((item) => [item.id, item.source_id]));
      const published = digest.items.flatMap((item) => bySource.get(item.id) ?? []);
      sourceStats = recordSourceStats(sourceStats, sourceCounts, published, today);
      statsTouched = true;
    }
    reports.push({
      id: digest.id,
      kind: pass.kind,
      outcome: "published",
      items: digest.items.length,
      verified: digest.verified,
      path: null,
      preview: null,
    });
  }
  seen = pruneSeen(seen, now);
  judgments = pruneJudgments(judgments, now);
  topicJudgments = pruneTopicJudgments(topicJudgments, now);

  const published = reports.filter((report) => report.outcome === "published");
  const outcome: Outcome = published.length > 0 ? "published" : "nothing";
  const items = published.reduce((sum, report) => sum + report.items, 0);

  if (dryRun) {
    // The preview lives in the cache, where the write guard never looks.
    const previews = new Map<string, string>();
    for (const digest of digests) {
      const path = passFile(root, digest.id, "digest-preview.md");
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, serializeDigestFile(digest), "utf8");
      previews.set(digest.id, `.cache/run/${digest.id}/digest-preview.md`);
    }
    if (spend && deps.spend) await commitDryRunCosts(deps, options, plan, nowIso, today);
    return {
      outcome,
      digests: reports.map((report) => ({ ...report, preview: previews.get(report.id) ?? null })),
      deploy: false,
      items,
      dry_run: true,
      commit: { status: "dry_run" },
      ...(spend ? { spend } : {}),
      ...(outcome === "nothing" ? { reason: "Nothing cleared the bar." } : {}),
    };
  }

  // Refuse before writing anything when the tree already holds changes the guard would block.
  const { allowlist } = await commandAllowlist(root, "run");
  const blocked = findViolations(await readChangedPaths(deps.git), allowlist);
  if (blocked.length > 0) {
    throw new StageFailure(
      `The working tree has changes outside the write allowlist, so nothing was written: ${blocked.join(", ")}`,
    );
  }

  // The old digest goes only now that a new one is ready, so a replacement that finds nothing keeps it.
  if (replaces !== undefined && digests.length > 0) await removeDigestFiles(root, replaces);
  for (const digest of digests) await writeDigestFile(root, digest);
  await writeSeen(root, seen);
  await writeJudgments(root, judgments);
  // New files are created only when there is something to keep, so a repository without custom
  // topics, or a run that recorded no counts, commits exactly the files it always did.
  if (Object.keys(topicJudgments.entries).length > 0) {
    await writeTopicJudgments(root, topicJudgments);
  }
  if (statsTouched) await writeSourceStats(root, sourceStats);
  if (spend) lastRun = { ...lastRun, spend: { at: nowIso, ...spend } };
  if (spend && deps.spend) await recordSpend(root, deps.spend, plan, nowIso);
  await writeLastRun(root, lastRun);
  if (!adopted) {
    // The run's health numbers go in the same commit. They describe the run and never stop it.
    try {
      await recordRunMetrics(
        root,
        await collectRunMetrics({
          root,
          plan,
          at: nowIso,
          totalMs: Date.parse(generatedAt) - Date.parse(plan.created_at),
          modelFallbacks: spend?.requests.model_fallback ?? 0,
          passes: passData.map((data, index) => {
            const report = reports[index];
            return {
              pass: data.pass,
              digestId: report?.id ?? data.pass.id,
              outcome: report?.outcome === "published" ? "published" : "nothing",
              verified: report?.verified ?? false,
              aired: report?.items ?? 0,
              pool: data.pool.items.length,
            };
          }),
        }),
      );
    } catch (error) {
      deps.log.warn("The run's metrics were not recorded", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const message =
    outcome === "published"
      ? `chore(digest): ${replaces === undefined ? "" : "replace "}${digests.map((digest) => digest.id).join(", ")}`
      : `chore(state): run ${today} nothing cleared the bar`;
  const committed = await commitAndPush({
    root,
    message,
    command: "run",
    push: !options.noPush,
    git: deps.git,
  });
  const commit = { ...describeCommit(committed), message };
  const finalReports = reports.map((report) => ({
    ...report,
    path: report.outcome === "published" ? digestRelPath(report.id) : null,
  }));

  // Once a local commit exists a second commit stage would publish the same run again, so the run
  // is marked done even when the push then failed; the failure is reported below.
  if (
    committed.status === "committed" ||
    committed.status === "pushed" ||
    committed.status === "push_failed"
  ) {
    if (adopted) {
      await markAdoptedCommitted(
        root,
        plan.passes[0]?.id ?? "",
        now,
        digests.map((d) => d.id),
      );
    } else {
      await writePlan(root, { ...plan, committed_at: nowIso });
    }
  }
  if (committed.status === "refused" || committed.status === "push_failed") {
    const reason =
      committed.status === "refused"
        ? `The commit was refused (${committed.reason}): ${committed.offending.join(", ")}`
        : `Committed ${committed.sha.slice(0, 7)} locally but the push failed (${committed.reason}). Run git push once the remote is reachable.`;
    return failedReport(false, reason, commit, finalReports);
  }

  const lacking = await digestsLackingAudio(root, now, DEPLOY_AUDIO_WINDOW_DAYS);
  return {
    outcome,
    digests: finalReports,
    deploy: published.length > 0 || lacking.length > 0,
    items,
    dry_run: false,
    commit,
    ...(spend ? { spend } : {}),
    ...(outcome === "nothing" ? { reason: "Nothing cleared the bar." } : {}),
  };
}

/**
 * No pass was planned: the gate said the regular digest is not due. Nothing about the cadence
 * changes (a gated run records nothing, or the next gate would lose its anchor), so the commit is
 * normally empty. It is still attempted so stray allowed changes land, and a refusal here only
 * warns: an unrelated edit in a developer's tree must not turn "not due" into a failure.
 */
async function commitGated(
  deps: RunDeps,
  options: RunOptions,
  plan: Plan,
  dryRun: boolean,
): Promise<CommitReport> {
  const now = deps.now();
  const lacking = await digestsLackingAudio(deps.root, now, DEPLOY_AUDIO_WINDOW_DAYS);
  const base: Pick<CommitReport, "outcome" | "digests" | "items" | "reason"> = {
    outcome: "gated",
    digests: [],
    items: 0,
    reason: plan.reason,
  };
  if (dryRun) {
    return { ...base, deploy: false, dry_run: true, commit: { status: "dry_run" } };
  }
  const message = "chore(state): gated";
  let commit: CommitReport["commit"];
  try {
    const committed = await commitAndPush({
      root: deps.root,
      message,
      command: "run",
      push: !options.noPush,
      git: deps.git,
    });
    commit = { ...describeCommit(committed), message };
    if (committed.status === "refused" || committed.status === "push_failed") {
      deps.log.warn("The gated commit did not complete", { detail: commit.detail ?? "" });
    }
  } catch (error) {
    // Git itself failing (not a repository, no git) must not turn "not due" into a failure.
    const detail = error instanceof Error ? (error.message.split("\n")[0] ?? "") : "";
    deps.log.warn("The gated commit could not run", { detail });
    commit = { status: "nothing_to_commit", message, detail };
  }
  return { ...base, deploy: lacking.length > 0, dry_run: false, commit };
}

/**
 * A dry run makes the paid calls a real run makes (45 Claude calls, about $1, on 2026-10-24) and
 * recorded none, so the Costs page missed them. Its spend goes to the ledger in a commit of the
 * ledger alone, under the publish allowlist, which holds the ledger and no digest the dry run
 * could have written; any other change in the tree refuses the commit, and a refusal only warns.
 */
async function commitDryRunCosts(
  deps: RunDeps,
  options: RunOptions,
  plan: Plan,
  nowIso: string,
  today: string,
): Promise<void> {
  if (!deps.spend) return;
  try {
    await recordSpend(deps.root, deps.spend, plan, nowIso);
    const committed = await commitAndPush({
      root: deps.root,
      message: `chore(costs): dry run ${today}`,
      command: "publish",
      push: !options.noPush,
      git: deps.git,
    });
    if (committed.status === "refused" || committed.status === "push_failed") {
      deps.log.warn("The dry run's costs were not committed", {
        detail: committed.status === "refused" ? committed.offending.join(", ") : committed.reason,
      });
    }
  } catch (error) {
    deps.log.warn("The dry run's costs were not committed", {
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
