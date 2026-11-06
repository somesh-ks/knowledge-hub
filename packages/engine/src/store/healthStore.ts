import type { SqlClient } from "./configPaths.js";
import { missingTable, withTable } from "./pgErrors.js";

/**
 * The newest `singularity health` report in Neon (D360), one row: every finding and the budget card,
 * so the Health page shows the daily check's budgets in the read it already makes of the store, with
 * no second wake. health.yml writes it after each daily run (`health --save`); the first write
 * creates the table. No driver here: see neon.ts.
 */

export const HEALTH_SCHEMA_SQL = [
  `create table if not exists health_reports (
  id text primary key,
  at timestamptz not null,
  report jsonb not null
)`,
] as const;

/** An area of the budget card: green, amber on a warning, red on a fault. */
export type CardArea = "cost" | "speed" | "tests" | "bugs" | "security" | "keys";
export type CardTone = "green" | "amber" | "red";

export interface CardRow {
  area: CardArea;
  label: string;
  tone: CardTone;
  /** The week's numbers for the area, in one line. */
  numbers: string;
}

/** What is stored of a report; the engine's HealthReport holds this and more. */
export interface StoredHealth {
  now: string;
  ok: boolean;
  findings: Array<{ code: string; aspect: string; severity: "fault" | "warning"; message: string }>;
  card: CardRow[];
}

const WRITE_SQL = `insert into health_reports (id, at, report) values ('latest', $1, $2::jsonb)
on conflict (id) do update set at = excluded.at, report = excluded.report`;

/** Replaces the stored report. Throws when the database does; the caller decides what that means. */
export async function saveHealthReport(sql: SqlClient, report: StoredHealth): Promise<void> {
  await withTable(sql, HEALTH_SCHEMA_SQL, () =>
    sql.query(WRITE_SQL, [report.now, JSON.stringify(report)]),
  );
}

/** The stored report; null when none was written yet or its shape is not one. Throws when the database does. */
export async function readHealthReport(sql: SqlClient): Promise<StoredHealth | null> {
  let rows: Record<string, unknown>[];
  try {
    rows = await sql.query("select report from health_reports where id = 'latest'");
  } catch (error) {
    if (missingTable(error)) return null;
    throw error;
  }
  const report = rows[0]?.report as Partial<StoredHealth> | undefined;
  return report && Array.isArray(report.card) && Array.isArray(report.findings)
    ? (report as StoredHealth)
    : null;
}
