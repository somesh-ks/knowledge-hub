import { loadAllCosts } from "./ledger.js";

/** What the ledger may hold for the last 24 hours before a scheduled run waits (D139, D332). */
export const DAILY_CEILING_USD = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Why a scheduled run should not start: the ledger's last 24 hours are already past the ceiling,
 * or null. The ledger records a run at its commit, so this reads what finished runs spent. A ledger
 * that does not read never stops a run: the health check reports the unreadable ledger.
 */
export async function spendCeilingStop(
  root: string,
  now: Date,
  ceilingUsd: number = DAILY_CEILING_USD,
): Promise<string | null> {
  const records = await loadAllCosts(root).catch(() => null);
  if (records === null) return null;
  const since = now.getTime() - DAY_MS;
  const spent = records
    .filter((record) => {
      const at = Date.parse(record.at);
      return at > since && at <= now.getTime();
    })
    .reduce((sum, record) => sum + record.usd, 0);
  if (spent <= ceilingUsd) return null;
  return `$${spent.toFixed(2)} spent in the last 24 hours, past the $${ceilingUsd} ceiling: a scheduled run waits (a run started by hand, or forced, goes ahead)`;
}
