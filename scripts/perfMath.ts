/**
 * The arithmetic of the lab probe (scripts/perfProbe.ts, D147), kept apart from the browser so it
 * can be tested: CLS by web.dev's session windows, TBT from long tasks, and the median of a page's
 * cold loads. CLS is the field collector's own (@singularity/core/vitals, D156), so lab and field
 * read it alike.
 */

export { cumulativeLayoutShift, type LayoutShift } from "@singularity/core/vitals";

export interface LongTask {
  startTime: number;
  duration: number;
}

export interface PageMetrics {
  lcp_ms: number;
  cls: number;
  tbt_ms: number;
}

/** The part of a long task past this blocks input (TBT). */
const BLOCKING_MS = 50;

/**
 * TBT: each long task's time past 50 ms, from `start` (first contentful paint, where Lighthouse
 * starts; a task across it counts from the paint) for the tasks that started before `end`.
 */
export function totalBlockingTime(tasks: readonly LongTask[], start: number, end: number): number {
  return tasks
    .filter((task) => task.startTime < end)
    .reduce((sum, task) => {
      const after = task.startTime + task.duration - Math.max(task.startTime, start);
      return sum + Math.max(0, after - BLOCKING_MS);
    }, 0);
}

function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** A page's reading: each metric's median over its loads, taken on its own. */
export function medianMetrics(runs: readonly PageMetrics[]): PageMetrics {
  return {
    lcp_ms: median(runs.map((run) => run.lcp_ms)),
    cls: median(runs.map((run) => run.cls)),
    tbt_ms: median(runs.map((run) => run.tbt_ms)),
  };
}
