/**
 * Blocked outlets, DOM-free so the server validates with it and the page shows the same domain it
 * will send. The rules mirror normalizeDomain in packages/engine/src/profile/profile.ts, which stores
 * what profile.block sends: blocking a domain blocks its subdomains, so `www.` is not kept.
 */
import type { ConfigOp } from "../types/contracts";

const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
/** A pasted address is long; a domain never is (a host name is at most 253 characters). */
export const MAX_BLOCK_INPUT = 2048;

/**
 * A domain or any address of the outlet as the domain to block: lowercase, with scheme, credentials,
 * `www.`, port, path, query and a trailing dot removed. Null when what is left is not a dotted host.
 */
export function blockedDomainOf(input: string): string | null {
  if (input.length > MAX_BLOCK_INPUT) return null;
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/^.*@/, "")
    .replace(/:\d*$/, "")
    .replace(/\.$/, "")
    .replace(/^www\./, "");
  return host.length <= 253 && DOMAIN.test(host) ? host : null;
}

/**
 * Whether `text` answers a typed filter: every word of the query is in it, in any case. A pasted
 * address counts as the domain it names, so the page's filter and the sheet's find a source by its
 * link as well as by its name.
 */
export function matchesQuery(text: string, query: string): boolean {
  const haystack = text.toLowerCase();
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(blockedDomainOf(word) ?? word));
}

/** The blocked domains a filter leaves, in their order; all of them for an empty filter. */
export function filterBlocked(domains: readonly string[], query: string): string[] {
  return domains.filter((domain) => matchesQuery(domain, query));
}

/**
 * The domain the sheet offers to block for what was typed when no catalogue source is the one meant:
 * the typed address as its domain, or null when it is not one or is already blocked.
 */
export function customBlock(query: string, blocked: ReadonlySet<string>): string | null {
  const domain = blockedDomainOf(query);
  return domain && !blocked.has(domain) ? domain : null;
}

/** The Blocked sources row's line and the page's count: "3 sources", "1 source" or "None". */
export function outletsSummary(count: number): string {
  return count === 0 ? "None" : `${count} ${count === 1 ? "source" : "sources"}`;
}

/** The blocked domains once the saved edits land: each block adds, each unblock removes, in order. */
export function savedBlocked(base: readonly string[], ops: readonly ConfigOp[]): string[] {
  const out = new Set(base);
  for (const op of ops) {
    if (op.op === "profile.block") {
      const domain = blockedDomainOf(op.domain);
      if (domain) out.add(domain);
    } else if (op.op === "profile.unblock") {
      const domain = blockedDomainOf(op.domain);
      if (domain) out.delete(domain);
    }
  }
  return [...out];
}
