import { vitalPage } from "@dispatch/core/vitals";
import {
  type ClientFault,
  OPAQUE_SCRIPT_ERROR,
  recordClientFault,
} from "@dispatch/engine/faults-store";
import { PLATFORM_CODE } from "../lib/platformFaults";
import { type DatabaseDeps, guardedDatabase } from "./database";

/**
 * Client faults (D158) on the server: `/api/report` hands a page's error, rejection or CSP
 * violation here, and only what the store keeps is read from it. The page becomes its route
 * template; a message keeps only its start, before anything a reader typed could be; a CSP
 * violation keeps its directive and the blocked origin; the script that raised it keeps its origin
 * or scheme (never a path or query); and the build is the page's own. A fault an extension raised
 * (a password manager or a dark mode injecting its own script) is not the site's and is dropped.
 * Anything else in the body is dropped.
 */

const MESSAGE_CHARS = 60;
const FAULT_TIMEOUT_MS = 5_000;
/** A message with no text left to keep. */
export const NO_MESSAGE = "no message text";

/**
 * Where a reader's words could start in a browser's message: any quote (V8 quotes the input it
 * failed on, an email or a topic's name among them), a new line, a digit, an `@`, a `/` or `www`.
 */
const USER_TEXT = /['"`‘’“”«»„\n\r\d@/]|www/i;
/** Control characters, NUL included (C0 and C1, tab, new line and return kept for the cut). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it removes
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

/**
 * The start of a message, before the first place a reader's text could begin, at most
 * MESSAGE_CHARS code points; the opaque "Script error." and an empty start get fixed labels.
 */
export function scrubMessage(value: unknown): string {
  if (typeof value !== "string") return NO_MESSAGE;
  const clean = value.replace(CONTROL, "");
  if (clean.trim() === "Script error.") return OPAQUE_SCRIPT_ERROR;
  const stop = clean.search(USER_TEXT);
  const head = (stop === -1 ? clean : clean.slice(0, stop)).replace(/\s+/g, " ").trim();
  // Array.from cuts on code points, so an emoji at the cut is never left half (a lone surrogate).
  const cut = Array.from(head).slice(0, MESSAGE_CHARS).join("").trim();
  return cut === "" ? NO_MESSAGE : cut;
}

/**
 * Schemes a browser extension's own scripts and pages load from. A report gives a non-web URL as
 * its bare scheme (CSP3 strips it), with or without the colon.
 */
const EXTENSION =
  /^(?:(?:chrome|moz|safari|safari-web|ms-browser|edge)-extension|webkit-masked-url):?$/;

/** A URL as its origin (http, https) or its scheme; a keyword (`inline`, `eval`) as itself. */
export function originOf(value: unknown): string {
  if (typeof value !== "string" || value === "") return "";
  if (/^[a-z-]{1,20}$/.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : url.protocol;
  } catch {
    return "";
  }
}

/** The page's own build id, or "" for anything else. */
function buildOf(data: Record<string, unknown>): string {
  return typeof data.build === "string" && /^[0-9a-z]{1,20}$/i.test(data.build) ? data.build : "";
}

/**
 * A 5xx Vercel answered for a function it killed, as the page saw it (lib/platformFaults.ts): the
 * API route as the server's own label (`api/narrate`, never a query) and Vercel's code. Forgeable
 * like every page report, so health only warns on it.
 */
function platformFault(data: Record<string, unknown>): ClientFault | null {
  const route = typeof data.route === "string" ? data.route : "";
  const code = typeof data.message === "string" ? data.message : "";
  if (!/^\/api\/[a-z0-9/-]{1,60}$/.test(route) || !PLATFORM_CODE.test(code)) return null;
  return {
    kind: "platform",
    page: route.slice(1),
    message: code,
    directive: "",
    blocked: "",
    source: "",
    build: buildOf(data),
  };
}

/** The fault as the store keeps it, or null for a kind it does not keep or one an extension raised. */
export function parseClientFault(data: Record<string, unknown>): ClientFault | null {
  const kind = data.kind;
  if (kind === "platform") return platformFault(data);
  if (kind !== "error" && kind !== "rejection" && kind !== "csp") return null;
  const blocked = kind === "csp" ? originOf(data.blocked) : "";
  const source = originOf(data.source);
  if (EXTENSION.test(blocked) || EXTENSION.test(source)) return null;
  // No page string is `other`, never the home page.
  const path = typeof data.page === "string" ? (data.page.split(/[?#]/, 1)[0] ?? "") : "";
  const directive =
    typeof data.directive === "string" && /^[a-z-]{1,40}$/.test(data.directive)
      ? data.directive
      : "";
  return {
    kind,
    page: vitalPage(path),
    message: kind === "csp" ? "" : scrubMessage(data.message),
    directive: kind === "csp" ? directive : "",
    blocked,
    source,
    build: buildOf(data),
  };
}

/** Stores a checked fault. Never throws: a store that is down or slow loses it, no more. */
export type FaultWriter = (fault: ClientFault) => Promise<void>;

export function createFaultWriter(deps: DatabaseDeps): FaultWriter {
  const now = deps.now ?? Date.now;
  // Apart from the `[client-fault]` JSON lines, so a search for faults finds faults.
  const log = deps.log ?? ((message: string) => console.error(`[fault-store] ${message}`));
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
