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

/** How long the breaker stays open before one call is let through to see whether Jev is back. */
export const DEFAULT_BREAKER_COOLDOWN_MS = 60_000;

/**
 * Stops a Jev outage from stalling a run. Each item retries 4 times over a 20 s timeout, so a dead
 * service cost about 107 s an item and hours across a run before the fallback judge started. After
 * `threshold` outage-class failures in a row (timeouts, 5xx, dropped connections; a 429 is a rate
 * limit that backs off, not an outage) every later call fails at once. Each retry attempt counts, so
 * a short burst of 5xx can open it; after `cooldownMs` one call is let through, and a success closes
 * the breaker again while another failure keeps it open for a further cooldown. Any success resets
 * the count.
 */
export function breakJev(
  client: JevClientLike,
  options: { threshold?: number; cooldownMs?: number; now?: () => number; log?: Logger } = {},
): JevClientLike {
  const threshold = options.threshold ?? DEFAULT_BREAKER_THRESHOLD;
  const cooldownMs = options.cooldownMs ?? DEFAULT_BREAKER_COOLDOWN_MS;
  const now = options.now ?? Date.now;
  let failures = 0;
  let openedAt: number | null = null;
  let probing = false;
  return {
    async systemOne(request) {
      let probe = false;
      if (openedAt !== null) {
        if (probing || now() - openedAt < cooldownMs) throw new JevUnavailableError(failures);
        probing = true;
        probe = true;
      }
      try {
        const reply = await client.systemOne(request);
        failures = 0;
        if (openedAt !== null) options.log?.info("Jev is back; asking it again");
        openedAt = null;
        return reply;
      } catch (error) {
        if (isRetryable(error) && errorStatus(error) !== 429) {
          failures += 1;
          if (probe || (failures >= threshold && openedAt === null)) {
            if (openedAt === null)
              options.log?.warn("Jev is down; this run uses the fallback judge until it answers", {
                failures,
              });
            openedAt = now();
          }
        } else {
          failures = 0;
          if (probe) openedAt = null;
        }
        throw error;
      } finally {
        if (probe) probing = false;
      }
    },
  };
}
