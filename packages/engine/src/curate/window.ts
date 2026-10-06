const DAY_MS = 86_400_000;

/** First run, with no earlier fetch to continue from. */
export const FIRST_RUN_DAYS = 3;
/** The window never reaches back further than this. */
export const MAX_WINDOW_DAYS = 7;

export interface DigestWindow {
  from: string;
  to: string;
}

/**
 * The span a digest covers: from the last successful fetch (or `since`, or 3 days back on a
 * first run), never more than 7 days, up to `now`.
 */
export function computeWindow(args: {
  now: Date;
  since?: string | undefined;
  lastFetchAt?: string | undefined;
}): DigestWindow {
  const earliest = args.now.getTime() - MAX_WINDOW_DAYS * DAY_MS;
  const requested = args.since ?? args.lastFetchAt;
  const parsed = requested === undefined ? Number.NaN : Date.parse(requested);
  const start = Number.isNaN(parsed) ? args.now.getTime() - FIRST_RUN_DAYS * DAY_MS : parsed;
  const from = Math.min(args.now.getTime(), Math.max(earliest, start));
  return { from: new Date(from).toISOString(), to: args.now.toISOString() };
}

/**
 * The window a run reports. `--since` wins, then the window the fetch recorded in the pool (the
 * span it actually covered), then the last-fetch rule in computeWindow.
 */
export function resolveWindow(args: {
  now: Date;
  since?: string | undefined;
  poolWindow?: DigestWindow | undefined;
  lastFetchAt?: string | undefined;
}): DigestWindow {
  if (args.since === undefined && args.poolWindow) return args.poolWindow;
  return computeWindow(args);
}
