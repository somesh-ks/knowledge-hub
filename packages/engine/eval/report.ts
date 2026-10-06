import type { GroundingRow, SweepRow, VoiceReport } from "./compare.js";

/** Plain-text tables for the eval script. Pure, so the layout is tested without any model call. */

export const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, i) => cell.padEnd(widths[i] ?? 0))
      .join("  ")
      .trimEnd();
  return [line(header), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

export function sweepTable(rows: readonly SweepRow[], best?: SweepRow): string {
  return table(
    [
      "threshold",
      "accuracy",
      "precision",
      "recall",
      "f1",
      "kept right",
      "kept wrong",
      "dropped wrong",
    ],
    rows.map((r) => [
      r.threshold.toFixed(2) + (best && r.threshold === best.threshold ? " *" : ""),
      percent(r.accuracy),
      percent(r.precision),
      percent(r.recall),
      r.f1.toFixed(3),
      String(r.confusion.tp),
      String(r.confusion.fp),
      String(r.confusion.fn),
    ]),
  );
}

export function groundingTable(rows: readonly GroundingRow[], best?: GroundingRow): string {
  return table(
    ["threshold", "accuracy", "false accepts", "false rejects", "failed checks"],
    rows.map((r) => [
      r.threshold.toFixed(2) + (best && r.threshold === best.threshold ? " *" : ""),
      percent(r.accuracy),
      String(r.falseAccept),
      String(r.falseReject),
      String(r.failed),
    ]),
  );
}

export interface BakeoffRow {
  model: string;
  /** Items the model failed to return valid JSON for. */
  jsonFailures: number;
  written: number;
  firstPass: VoiceReport;
  afterRewrite: VoiceReport;
  /** Share of grounded sentences the checker supported, or null when no grounder ran. */
  grounded: number | null;
  tokens: number;
}

export function bakeoffTable(rows: readonly BakeoffRow[]): string {
  return table(
    [
      "model",
      "written",
      "json failures",
      "lint pass (fields)",
      "lint pass (items)",
      "after 1 rewrite",
      "grounded",
      "tokens",
    ],
    rows.map((r) => [
      r.model,
      String(r.written),
      String(r.jsonFailures),
      percent(r.firstPass.fieldPassRate),
      percent(r.firstPass.itemPassRate),
      percent(r.afterRewrite.itemPassRate),
      r.grounded === null ? "n/a" : percent(r.grounded),
      String(r.tokens),
    ]),
  );
}

/** The lint rules a model breaks most, for the bake-off notes. */
export function topRules(report: VoiceReport, limit = 3): string {
  const entries = Object.entries(report.byRule)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
  return entries.length === 0 ? "none" : entries.map(([rule, n]) => `${rule} x${n}`).join(", ");
}
