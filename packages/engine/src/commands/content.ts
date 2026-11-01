import { type CommandContext, type CommandRun, secretsFromEnv } from "../context.js";
import { emit } from "../curate/output.js";
import { describeError } from "../llm/errors.js";
import { type ConditionalBlobClient, createVercelBlobClient } from "../publish/blob.js";
import { applyContentDelta } from "../publish/contentDelta.js";
import { pullContent } from "../publish/contentPull.js";
import { syncContent } from "../publish/contentSync.js";

export const CONTENT_USAGE = `Usage: singularity content <command>

  sync                       Mirror the checkout's content files into the store and delete what the
                             checkout lacks. Safe only while git holds all of the content.
  put <path>...              Add or replace these files, leaving every other path as it is (D300).
  remove <path>...           Remove these paths from the store, leaving every other path as it is.
  pull [<path>...]           Copy the store's files into this checkout, Digests and Podcasts unless
                             paths are named. Adds and replaces; never deletes.`;

export interface ContentDeps {
  blob?: ConditionalBlobClient;
  fetchText?: (url: string) => Promise<string | null>;
  fetchBytes?: (url: string) => Promise<Uint8Array | null>;
}

async function fetchText(url: string): Promise<string | null> {
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Store read failed: HTTP ${res.status}`);
  return await res.text();
}

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Store read failed: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** `singularity content sync`: mirror the content files of the checkout into the content store (D173). */
export function makeContentCommand(deps: ContentDeps = {}): CommandRun {
  return async (argv, ctx: CommandContext) => {
    const [command, ...paths] = argv;
    const known =
      command === "sync" || command === "put" || command === "remove" || command === "pull";
    if (
      !known ||
      (command === "sync" && paths.length > 0) ||
      ((command === "put" || command === "remove") && paths.length === 0)
    ) {
      ctx.log.error(CONTENT_USAGE);
      return 2;
    }
    const token = ctx.env.BLOB_READ_WRITE_TOKEN;
    const client = deps.blob ?? (token ? createVercelBlobClient(token) : null);
    if (!client) {
      ctx.log.error("BLOB_READ_WRITE_TOKEN is not set, so there is no content store to sync to.");
      return 1;
    }
    try {
      if (command === "put" || command === "remove") {
        const result = await applyContentDelta({
          client,
          root: ctx.root,
          now: ctx.now(),
          fetchText: deps.fetchText ?? fetchText,
          put: command === "put" ? paths : [],
          remove: command === "remove" ? paths : [],
        });
        emit(
          ctx,
          [
            `Content store: ${result.uploaded.length} uploaded, ${result.removed.length} removed, ${result.unchanged.length} unchanged.`,
            ...result.uploaded.map((path) => `+ ${path}`),
            ...result.removed.map((path) => `- ${path}`),
          ],
          { ...result },
        );
        return 0;
      }
      if (command === "pull") {
        const result = await pullContent({
          client,
          root: ctx.root,
          fetchText: deps.fetchText ?? fetchText,
          fetchBytes: deps.fetchBytes ?? fetchBytes,
          only: paths.length > 0 ? paths : ["Digests", "Podcasts"],
        });
        emit(
          ctx,
          [
            `Content store: ${result.written.length} pulled, ${result.unchanged} already here.`,
            ...result.written.map((path) => `< ${path}`),
          ],
          { ...result },
        );
        return 0;
      }
      const result = await syncContent({
        client,
        root: ctx.root,
        now: ctx.now(),
        fetchText: deps.fetchText ?? fetchText,
      });
      emit(
        ctx,
        [
          `Content store: ${result.uploaded.length} uploaded, ${result.deleted.length} deleted, ${result.unchanged} unchanged.`,
          ...result.uploaded.map((path) => `+ ${path}`),
          ...result.deleted.map((path) => `- ${path}`),
        ],
        { ...result },
      );
      return 0;
    } catch (error) {
      ctx.log.error(`content command failed: ${describeError(error, secretsFromEnv(ctx.env))}`);
      return 1;
    }
  };
}

export const run: CommandRun = makeContentCommand();
