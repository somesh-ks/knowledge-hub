import { formatSpend } from "./spend.js";
import type {
  CommitReport,
  DeleteReport,
  FailureReport,
  GateReport,
  PipelineResult,
  StageReport,
} from "./types.js";

function isFailure(report: PipelineResult["report"]): report is FailureReport {
  return "outcome" in report && report.outcome === "failed" && "stage" in report;
}

function isGate(report: PipelineResult["report"]): report is GateReport {
  return "due" in report;
}

function isStage(report: PipelineResult["report"]): report is StageReport {
  return "stage" in report && "ok" in report;
}

function formatGate(report: GateReport): string[] {
  const lines = [
    report.due ? `Run is due (${report.mode}): ${report.reason}.` : `Not due: ${report.reason}.`,
  ];
  for (const pass of report.passes) {
    lines.push(`  ${pass.id} (${pass.kind}), window ${pass.window.from} to ${pass.window.to}`);
  }
  if (report.dry_run) lines.push("Dry run: nothing will be written or committed.");
  return lines;
}

function isDelete(report: PipelineResult["report"]): report is DeleteReport {
  return "outcome" in report && report.outcome === "deleted";
}

function formatDelete(report: DeleteReport): string {
  return `${report.dry_run ? "Would remove" : "Removed"} ${report.removed.join(", ")} (${report.commit}).`;
}

function formatStage(report: StageReport): string[] {
  const lines = [`Stage ${report.stage} done${report.dry_run ? " (dry run)" : ""}.`];
  for (const pass of report.passes) {
    const { id, kind, ...detail } = pass;
    lines.push(`  ${id} (${kind}) ${JSON.stringify(detail)}`);
  }
  if (report.spend) lines.push(`Requests so far: ${formatSpend(report.spend)}`);
  return lines;
}

function formatCommit(report: CommitReport): string[] {
  const lines = [`Outcome: ${report.outcome}${report.dry_run ? " (dry run)" : ""}.`];
  if (report.reason) lines.push(report.reason);
  for (const digest of report.digests) {
    lines.push(
      `  ${digest.id} (${digest.kind}): ${digest.outcome}, ${digest.items} items${digest.verified ? ", verified" : ""}`,
    );
  }
  const commit = report.commit;
  lines.push(
    `Commit: ${commit.status}${commit.sha ? ` ${commit.sha.slice(0, 7)}` : ""}${commit.message ? ` "${commit.message}"` : ""}${commit.detail ? ` (${commit.detail})` : ""}`,
  );
  lines.push(`Deploy: ${report.deploy ? "yes" : "no"}`);
  if (report.spend) lines.push(`Requests: ${formatSpend(report.spend)}`);
  return lines;
}

/** Human-readable form of a pipeline report, for runs without `--json`. */
export function formatReport(report: PipelineResult["report"]): string {
  if (isFailure(report)) return `Failed at ${report.stage}: ${report.error}`;
  if (isGate(report)) return formatGate(report).join("\n");
  if (isDelete(report)) return formatDelete(report);
  if (isStage(report)) return formatStage(report).join("\n");
  return formatCommit(report).join("\n");
}
