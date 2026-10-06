export interface Limiter {
  /** Run `task` when a slot is free. Tasks start in the order they were submitted. */
  run<T>(task: () => Promise<T>): Promise<T>;
}

export interface LimiterOptions {
  /** Minimum gap between the starts of two tasks, for services with a request-rate limit. */
  minIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** A counting semaphore with an optional spacing between starts. */
export function createLimiter(concurrency: number, options: LimiterOptions = {}): Limiter {
  const limit = Math.max(1, concurrency);
  const interval = options.minIntervalMs ?? 0;
  const sleep = options.sleep ?? defaultSleep;
  const clock = options.clock ?? Date.now;
  let active = 0;
  let nextStart = 0;
  const waiting: (() => void)[] = [];

  const acquire = async (): Promise<void> => {
    if (active >= limit) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      active++;
    }
    if (interval > 0) {
      // Reserve the start slot before awaiting so concurrent tasks queue behind each other.
      const startAt = Math.max(clock(), nextStart);
      nextStart = startAt + interval;
      const delay = startAt - clock();
      if (delay > 0) await sleep(delay);
    }
  };

  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
}
