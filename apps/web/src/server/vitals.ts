import {
  VITAL_CONNECTIONS,
  VITAL_DEVICES,
  VITAL_MAX,
  VITAL_METRICS,
  type VitalMetric,
  vitalPage,
} from "@dispatch/core/vitals";
import { recordVitals, type VitalsReport } from "@dispatch/engine/vitals-store";
import { type DatabaseDeps, guardedDatabase } from "./database";

/**
 * Field Web Vitals (D156) on the server: `/api/report` hands a page's `vitals` report here. Only
 * what the store keeps is read from it, each field checked: the route template (applied again, so
 * an address never reaches the store), the device class, the connection type and the three
 * metrics within their bounds. Anything else in the body is dropped.
 */

/** A beacon has no reader waiting on it, so it waits for a database waking from idle. */
const VITALS_TIMEOUT_MS = 5_000;

/** The report as the store keeps it, or null when it carries no metric worth keeping. */
export function parseVitals(data: Record<string, unknown>): VitalsReport | null {
  const device = VITAL_DEVICES.find((each) => each === data.device);
  if (typeof data.page !== "string" || !device) return null;
  const values: Partial<Record<VitalMetric, number>> = {};
  for (const metric of VITAL_METRICS) {
    const value = data[metric];
    if (typeof value === "number" && value >= 0 && value <= VITAL_MAX[metric]) {
      values[metric] = value;
    }
  }
  if (Object.keys(values).length === 0) return null;
  const connection = VITAL_CONNECTIONS.find((each) => each === data.connection) ?? null;
  return { page: vitalPage(data.page), device, connection, values };
}

/** Stores a checked report. Never throws: a store that is down or slow loses the sample, no more. */
export type VitalsWriter = (report: VitalsReport) => Promise<void>;

export function createVitalsWriter(deps: DatabaseDeps): VitalsWriter {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((message: string) => console.error(`[vitals] ${message}`));
  const database = guardedDatabase({
    timeoutMs: VITALS_TIMEOUT_MS,
    ...deps,
    log: (message) => log(`store ${message}, sample dropped`),
  });
  return async (report) => {
    await database(async (sql) => {
      await recordVitals(sql, report, now());
    }, undefined);
  };
}

/** The site's writer, one per instance. */
export const storeVitals: VitalsWriter = createVitalsWriter({
  databaseUrl: process.env.DATABASE_URL,
});
