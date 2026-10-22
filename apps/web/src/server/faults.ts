import { vitalPage } from "@dispatch/core/vitals";
import { type ClientFault, recordClientFault } from "@dispatch/engine/faults-store";
import { type DatabaseDeps, guardedDatabase } from "./database";

/**
 * Client faults (D158) on the server: `/api/report` hands a page's error, rejection or CSP
 * violation here, and only what the store keeps is read from it. The page becomes its route
 * template, a message loses quoted text, addresses and numbers (where user text would be) and is
 * cut, a CSP violation keeps its directive and the blocked origin (never a path or query), and the
 * build is the page's own. Anything else in the body is dropped.
 */

const MESSAGE_CHARS = 120;
const FAULT_TIMEOUT_MS = 5_000;

/** A message with what could carry user text taken out: quoted strings, URLs, numbers. */
export function scrubMessage(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/(["'`])(?:(?!\1).)*\1/g, "…")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>")
    .replace(/\d+/g, "N")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MESSAGE_CHARS);
}

/** A CSP blocked URI as its origin, or a keyword (`inline`, `eval`, `data`); never a path. */
export function blockedOrigin(value: unknown): string {
  if (typeof value !== "string" || value === "") return "";
  if (/^[a-z-]{1,20}$/.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : url.protocol;
  } catch {
    return "";
  }
}

/** The fault as the store keeps it, or null for a kind it does not keep. */
export function parseClientFault(data: Record<string, unknown>): ClientFault | null {
  const kind = data.kind;
  if (kind !== "error" && kind !== "rejection" && kind !== "csp") return null;
  const path = typeof data.page === "string" ? data.page.split(/[?#]/, 1)[0] : "";
  const directive =
    typeof data.directive === "string" && /^[a-z-]{1,40}$/.test(data.directive)
      ? data.directive
      : "";
  return {
    kind,
    page: vitalPage(path || "/"),
    message: kind === "csp" ? "" : scrubMessage(data.message),
    directive: kind === "csp" ? directive : "",
    blocked: kind === "csp" ? blockedOrigin(data.blocked) : "",
    build: typeof data.build === "string" && /^[0-9a-z]{1,20}$/i.test(data.build) ? data.build : "",
  };
}

/** Stores a checked fault. Never throws: a store that is down or slow loses it, no more. */
export type FaultWriter = (fault: ClientFault) => Promise<void>;

export function createFaultWriter(deps: DatabaseDeps): FaultWriter {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((message: string) => console.error(`[client-fault] ${message}`));
  const database = guardedDatabase({
    timeoutMs: FAULT_TIMEOUT_MS,
    ...deps,
    log: (message) => log(`store ${message}, fault dropped`),
  });
  return async (fault) => {
    await database(async (sql) => {
      await recordClientFault(sql, fault, now());
    }, undefined);
  };
}

/** The site's writer, one per instance. */
export const storeFault: FaultWriter = createFaultWriter({
  databaseUrl: process.env.DATABASE_URL,
});
