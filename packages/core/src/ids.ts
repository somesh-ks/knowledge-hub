import { createHash } from "node:crypto";

/** Item id: the first 12 hex characters of sha1(canonical_url). */
export function itemId(canonicalUrl: string): string {
  return createHash("sha1").update(canonicalUrl).digest("hex").slice(0, 12);
}

/** Short stable hash of any JSON-serializable value, used for cache keys. */
export function hashOf(value: unknown): string {
  return createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 12);
}
