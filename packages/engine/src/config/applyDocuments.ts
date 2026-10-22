import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type ParsedConfigOp, parseConfigOps } from "@dispatch/core";
import { combineOutcomes, readBundle, renderBundle } from "../commands/config.js";
import { createHttpClient } from "../http.js";
import type { DiscoverDeps } from "../sources/discover.js";
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
  | { ok: false; message: string };

export async function applyOpsToDocuments(
  input: ApplyToDocumentsInput,
): Promise<ApplyToDocumentsResult> {
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
    const discover = input.discover ?? { http: createHttpClient({ retries: 1 }) };
    const outcomes: OpOutcome[] = [];
    let current = before;
    for (const op of parsed.data as ParsedConfigOp[]) {
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
    if (error instanceof ConfigOpError) return { ok: false, message: error.message };
    throw error;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
