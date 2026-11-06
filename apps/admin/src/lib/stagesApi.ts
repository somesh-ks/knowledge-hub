import type { StageTimingRow } from "./stageTimings.js";

/**
 * What the Health page's Stage times card asks of its function (api/stages.ts): the median and
 * slowest-tenth time of each pipeline stage over the last days, as the store holds them. The handler
 * takes the read as `read`, so a test drives it without Neon.
 */
export const STAGE_DAYS = 14;

export interface StagesAnswer {
  status: number;
  body: unknown;
}

export async function handleStages(
  method: string,
  read: (() => Promise<StageTimingRow[]>) | null,
): Promise<StagesAnswer> {
  if (method !== "GET") return { status: 405, body: { error: "method_not_allowed" } };
  if (read === null) return { status: 503, body: { error: "no_store" } };
  try {
    return { status: 200, body: { days: STAGE_DAYS, timings: await read() } };
  } catch {
    // A database that does not answer is not the page's fault: it says so and keeps the rest.
    return { status: 502, body: { error: "store_unavailable" } };
  }
}
