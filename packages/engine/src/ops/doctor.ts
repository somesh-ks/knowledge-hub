import type { CommandContext } from "../context.js";
import { loadWriterModel } from "../writer/store.js";
import { offlineChecks } from "./doctorOffline.js";
import { onlineChecks } from "./doctorOnline.js";
import type { Check, CheckStatus, DoctorDeps, DoctorReport } from "./doctorTypes.js";

export { similarModels } from "./doctorOnline.js";
export type { Check, CheckStatus, DoctorDeps, DoctorReport } from "./doctorTypes.js";

export function summarizeChecks(checks: readonly Check[], online: boolean): DoctorReport {
  const totals = { ok: 0, warn: 0, fail: 0 };
  for (const check of checks) totals[check.status] += 1;
  return { version: 1, online, ok: totals.fail === 0, totals, checks: [...checks] };
}

const MARK: Record<CheckStatus, string> = { ok: "ok  ", warn: "warn", fail: "FAIL" };

export function formatDoctor(report: DoctorReport): string {
  const lines: string[] = [];
  for (const check of report.checks) {
    lines.push(`${MARK[check.status]}  ${check.id.padEnd(30)} ${check.summary}`);
    if (check.hint) lines.push(`      fix: ${check.hint}`);
  }
  lines.push(
    "",
    `${report.totals.ok} ok, ${report.totals.warn} warnings, ${report.totals.fail} failed${report.online ? "" : " (offline; add --online to check the services)"}`,
  );
  return lines.join("\n");
}

export async function runDoctor(
  ctx: CommandContext,
  deps: DoctorDeps,
  online: boolean,
  secrets: readonly string[],
): Promise<DoctorReport> {
  const checks = await offlineChecks(ctx.root, ctx.env, deps);
  if (online)
    checks.push(...(await onlineChecks(ctx.env, deps, secrets, loadWriterModel(ctx.root))));
  return summarizeChecks(checks, online);
}
