import type { Report } from "@singularity/core";

const usd = (n: number): string => `$${n.toFixed(n < 1 ? 4 : 2)}`;

/** The report as plain lines: one row per period (and group), then the totals and averages. */
export function formatCostReport(report: Report, timeZone: string): string {
  if (report.buckets.length === 0) return "No costs recorded in this range.";
  const lines = [`Costs in ${timeZone} (USD, prices from config/prices.json)`];
  for (const { bucket, total, groups } of report.buckets) {
    lines.push(
      `${bucket}  ${usd(total.usd)}  shared ${usd(total.shared_usd)}  runs ${total.runs}${total.unpriced ? "  (some units unpriced)" : ""}`,
    );
    for (const [name, group] of Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`  ${name.padEnd(20)} ${usd(group.usd)}`);
    }
  }
  lines.push(
    `Total ${usd(report.total.usd)} over ${report.total.runs} runs and ${report.users} users`,
    `Per run ${usd(report.per_run_usd)}, per user ${usd(report.per_user_usd)}`,
  );
  return lines.join("\n");
}
