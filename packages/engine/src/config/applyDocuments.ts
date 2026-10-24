import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type ParsedConfigOp, parseConfigOps } from "@dispatch/core";
import { combineOutcomes, readBundle, renderBundle } from "../commands/config.js";
import { createHttpClient, type HttpClient, type RequestOptions } from "../http.js";
import { AddSourceError } from "../sources/addSource.js";
import { type DiscoverDeps, networkErrorCode } from "../sources/discover.js";
import {
  CONFIG_DOCUMENT_PATHS,
  type ConfigDocument,
  type DocumentWrite,
} from "../store/configDocs.js";
import { applyConfigOp, ConfigOpError, type OpOutcome } from "./applyOp.js";

export {
  type ConfigDocument,
  configStoreUrl,
  connectConfigStore,
  lastConfigWrite,
  readConfigDocuments,
  type SqlClient,
  writeConfigDocuments,
  writeConfigDocumentsAt,
} from "../store/configDocs.js";
export { ConfigOpError } from "./applyOp.js";

/**
 * What the site's /api/config does with an edit once the config store is on (D149): the same
 * `applyConfigOp` that `dispatch config apply` runs, on the stored documents instead of a checkout.
 * The loaders read files, so the documents are laid out in a scratch directory with the read-only
 * files the bundle also needs (the seed sources), applied, rendered and compared.
 */
export interface ApplyToDocumentsInput {
  /** The validated edits as the app sent them (one op or several). */
  ops: unknown;
  documents: readonly ConfigDocument[];
  /** Read-only files the bundle reads besides the documents, by repository path. */
  baseFiles: Readonly<Record<string, string>>;
  discover?: DiscoverDeps;
}

export type ApplyToDocumentsResult =
  | { ok: true; writes: DocumentWrite[]; outcome: OpOutcome; documents: Record<string, string> }
  /** `retryable`: the network failed or the time ran out, not the edit; the caller answers 503. */
  | {
      ok: false;
      message: string;
      retryable?: boolean;
      /** Which op of `input.ops` the engine refused, when one op did (a lone op is index 0). */
      op_index?: number;
    };

/** The whole edit, well inside the function's 20 s (functionLimits.mjs). */
export const APPLY_DEADLINE_MS = 12_000;
/** A lookup that names no timeout of its own; discovery names its own (12 s a page, 10 s a probe). */
const LOOKUP_TIMEOUT_MS = 10_000;
/** Kept back from the deadline, so the last request's failure is still seen before it. */
const DEADLINE_MARGIN_MS = 250;

/**
 * Discovery keeps its own timeouts and retry, so a slow page still gets its feed found, but no
 * request may wait past the edit's deadline (D149): what is left of it caps each one.
 */
const lookupOptions = (
  options: RequestOptions | undefined,
  deadlineAt: number,
  deadline: AbortSignal,
): RequestOptions => ({
  ...options,
  timeoutMs: Math.max(
    1,
    Math.min(options?.timeoutMs ?? LOOKUP_TIMEOUT_MS, deadlineAt - Date.now() - DEADLINE_MARGIN_MS),
  ),
  // Discovery's retry gets the time left too: once the deadline passes, nothing is asked again.
  signal: options?.signal ? AbortSignal.any([options.signal, deadline]) : deadline,
});

/**
 * Notes when a lookup failed for a reason that is not the address's: no answer, a timeout or a 5xx.
 * A 4xx or a host that does not resolve (ENOTFOUND, however deep in the cause chain undici puts it)
 * is the address's fault and stays a refusal.
 */
function watchNetwork(
  http: HttpClient,
  failed: { network: boolean },
  deadlineAt: number,
): HttpClient {
  const deadline = AbortSignal.timeout(Math.max(1, deadlineAt - Date.now()));
  const watch = <T>(call: Promise<T>): Promise<T> =>
    call.catch((error: unknown) => {
      const status = (error as { status?: unknown }).status;
      const theirs =
        (typeof status === "number" && status < 500) || networkErrorCode(error) === "ENOTFOUND";
      if (!theirs) failed.network = true;
      throw error;
    });
  return {
    fetchText: (url, options) =>
      watch(http.fetchText(url, lookupOptions(options, deadlineAt, deadline))),
    getJson: (url, options) =>
      watch(http.getJson(url, lookupOptions(options, deadlineAt, deadline))),
    postJson: (url, body, options) =>
      watch(http.postJson(url, body, lookupOptions(options, deadlineAt, deadline))),
  };
}

/**
 * Whether a refused op may be sent again: a lookup of its own failed on our side, and the refusal is
 * not one the address itself gives (a duplicate, a dead page), whatever a probe did on the way.
 */
function retryable(error: ConfigOpError, network: boolean): boolean {
  const cause = error.cause;
  return network && !(cause instanceof AddSourceError && cause.definite);
}

export async function applyOpsToDocuments(
  input: ApplyToDocumentsInput,
  deadlineMs = APPLY_DEADLINE_MS,
): Promise<ApplyToDocumentsResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<ApplyToDocumentsResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, message: "the edit took too long", retryable: true }),
      deadlineMs,
    );
  });
  try {
    return await Promise.race([applyNow(input, Date.now() + deadlineMs), late]);
  } finally {
    clearTimeout(timer);
  }
}

async function applyNow(
  input: ApplyToDocumentsInput,
  deadlineAt: number,
): Promise<ApplyToDocumentsResult> {
  const failed = { network: false };
  let opIndex: number | undefined;
  const parsed = parseConfigOps(input.ops);
  if (!parsed.success) {
    return { ok: false, message: parsed.issues.map((issue) => issue.message).join("; ") };
  }
  const root = await mkdtemp(join(tmpdir(), "dispatch-config-"));
  try {
    const files: Record<string, string> = { ...input.baseFiles };
    for (const document of input.documents) files[document.path] = document.content;
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text, "utf8");
    }
    const before = await readBundle(root);
    const http =
      input.discover?.http ?? createHttpClient({ retries: 0, timeoutMs: LOOKUP_TIMEOUT_MS });
    const discover: DiscoverDeps = {
      ...input.discover,
      http: watchNetwork(http, failed, deadlineAt),
    };
    const outcomes: OpOutcome[] = [];
    let current = before;
    let index = 0;
    for (const op of parsed.data as ParsedConfigOp[]) {
      // Each op answers for its own lookups: a probe that timed out while an earlier add succeeded
      // does not make a later refusal look like ours.
      failed.network = false;
      opIndex = index;
      index += 1;
      const outcome = await applyConfigOp(op, current, { discover });
      outcomes.push(outcome);
      current = outcome.next;
    }
    const outcome = combineOutcomes(outcomes);
    const was = renderBundle(before);
    const now = renderBundle(outcome.next);
    const versions = new Map(input.documents.map((document) => [document.path, document.version]));
    const writes: DocumentWrite[] = [];
    for (const path of CONFIG_DOCUMENT_PATHS) {
      const text = now[path];
      // As `config apply` does: only what the edit changed is written, never a file of defaults.
      if (text === undefined || text === was[path] || text === files[path]) continue;
      writes.push({ path, content: text, version: versions.get(path) ?? null });
    }
    const documents = Object.fromEntries(
      CONFIG_DOCUMENT_PATHS.flatMap((path) => {
        const text = writes.find((write) => write.path === path)?.content ?? files[path];
        return text === undefined ? [] : [[path, text]];
      }),
    );
    return { ok: true, writes, outcome, documents };
  } catch (error) {
    if (error instanceof ConfigOpError) {
      return {
        ok: false,
        message: error.message,
        retryable: retryable(error, failed.network),
        ...(opIndex === undefined ? {} : { op_index: opIndex }),
      };
    }
    throw error;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
