import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Who may stop a run (D242). A run's cancel token is an HMAC of its id, keyed by the site's GitHub
 * token, which never leaves the server. /api/generate and /api/podcast hand it to whoever started the
 * run; /api/cancel stops a run only when the token matches. So a reader can stop what they started,
 * and no one can stop a run they did not start: another person's, or the schedule's. It needs no
 * new secret, and rotating the GitHub token only makes the tokens of runs under way stop working.
 */
const CONTEXT = "singularity:cancel:v1";

export function cancelTokenFor(secret: string, runId: number): string {
  return createHmac("sha256", secret).update(`${CONTEXT}:${runId}`).digest("hex");
}

export function cancelTokenMatches(secret: string, runId: number, given: unknown): boolean {
  if (typeof given !== "string") return false;
  const expected = Buffer.from(cancelTokenFor(secret, runId));
  const actual = Buffer.from(given);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
