import type { Logger } from "../context.js";
import { errorStatus } from "../llm/errors.js";
import { isRetryable } from "../llm/retry.js";
import type { JevClientLike } from "./jev.js";

/** Consecutive outage-class failures that open the breaker. About one full round of the 8 in-flight requests. */
export const DEFAULT_BREAKER_THRESHOLD = 8;

/** Raised for every Jev call after the breaker opened. Not retryable: the item goes to the fallback at once. */
export class JevUnavailableError extends Error {
  constructor(failures: number) {
    super(`Jev is unavailable: ${failures} requests in a row failed, so this run stops asking it.`);
    this.name = "JevUnavailableError";
  }
}

/**
 * Stops a Jev outage from stalling a run. Each item retries 4 times over a 20 s timeout, so a dead
 * service cost about 107 s an item and hours across a run before the fallback judge started. After
 * `threshold` outage-class failures in a row (timeouts, 5xx, dropped connections; a 429 is a rate
 * limit that backs off, not an outage) every later call fails at once for the rest of the run.
 * Any success resets the count.
 */
export function breakJev(
  client: JevClientLike,
  options: { threshold?: number; log?: Logger } = {},
): JevClientLike {
  const threshold = options.threshold ?? DEFAULT_BREAKER_THRESHOLD;
  let failures = 0;
  let open = false;
  return {
    async systemOne(request) {
      if (open) throw new JevUnavailableError(failures);
      try {
        const reply = await client.systemOne(request);
        failures = 0;
        return reply;
      } catch (error) {
        if (isRetryable(error) && errorStatus(error) !== 429) {
          failures += 1;
          if (failures >= threshold && !open) {
            open = true;
            options.log?.warn("Jev is down; the rest of this run uses the fallback judge", {
              failures,
            });
          }
        } else {
          failures = 0;
        }
        throw error;
      }
    },
  };
}
