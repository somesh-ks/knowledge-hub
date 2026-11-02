import { type CommandContext, type CommandRun, secretsFromEnv } from "../context.js";
import { emit } from "../curate/output.js";
import { describeError } from "../llm/errors.js";
import { type ConditionalBlobClient, createVercelBlobClient } from "../publish/blob.js";
import { applyContentDelta } from "../publish/contentDelta.js";
import { fetchBytes, fetchText } from "../publish/contentFetch.js";
import { pullContent } from "../publish/contentPull.js";
import { syncContent } from "../publish/contentSync.js";
import { pullWorkspace, pushWorkspace } from "../publish/contentWorkspace.js";

export const CONTENT_USAGE = `Usage: singularity content <command>

  sync                       Mirror the checkout's content files into the store and delete what the
                             checkout lacks. Safe only while git holds all of the content.
  put <path>...              Add or replace these files, leaving every other path as it is (D300).
  remove <path>...           Remove these paths from the store, leaving every other path as it is.
  pull [<path>...]           Copy the store's files into this checkout, Digests and Podcasts unless
                             paths are named. Adds and replaces; never deletes.
  pull --track               The same for Digests and Podcasts, and records what the store held, so
                             push sends back only this job's changes (workflows use it).
  push                       Send what this checkout changed since a tracked pull: new and rewritten
                             digests and episodes are put, deleted ones removed, nothing else touched.`;

export interface ContentDeps {
  blob?: ConditionalBlobClient;
  fetchText?: (url: string) => Promise<string | null>;
  fetchBytes?: (url: string) => Promise<Uint8Array | null>;
}

/** `singularity content sync`: mirror the content files of the checkout into the content store (D173). */
export function makeContentCommand(deps: ContentDeps = {}): CommandRun {
  return async (argv, ctx: CommandContext) => {
    const [command, ...rest] = argv;
    const track = rest.includes("--track");
    const paths = rest.filter((arg) => arg !== "--track");
    const known =
      command === "sync" ||
      command === "put" ||
      command === "remove" ||
      command === "pull" ||
      command === "push";
    if (
      !known ||
      (track && command !== "pull") ||
      (track && paths.length > 0) ||
      ((command === "sync" || command === "push") && paths.length > 0) ||
      ((command === "put" || command === "remove") && paths.length === 0)
    ) {
      ctx.log.error(CONTENT_USAGE);
      return 2;
    }
    // The long-lived token, or the short-lived pair `vercel env pull` issues (audio.yml's fallback).
    const token = ctx.env.BLOB_READ_WRITE_TOKEN;
    const { VERCEL_OIDC_TOKEN: oidcToken, BLOB_STORE_ID: storeId } = ctx.env;
    const client =
      deps.blob ??
      (token
        ? createVercelBlobClient(token)
        : oidcToken && storeId
          ? createVercelBlobClient({ oidcToken, storeId })
          : null);
    if (!client) {
      ctx.log.error(
        "BLOB_READ_WRITE_TOKEN is not set (nor VERCEL_OIDC_TOKEN with BLOB_STORE_ID), so there is no content store.",
      );
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
      if (command === "push") {
        const result = await pushWorkspace({
          client,
          root: ctx.root,
          now: ctx.now(),
          fetchText: deps.fetchText ?? fetchText,
        });
        if (result === null) {
          ctx.log.error(
            "Nothing was pulled into this checkout (content pull --track), so there is nothing to push.",
          );
          return 1;
        }
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
        const pullInput = {
          client,
          root: ctx.root,
          now: ctx.now(),
          fetchText: deps.fetchText ?? fetchText,
          fetchBytes: deps.fetchBytes ?? fetchBytes,
        };
        const result = track
          ? await pullWorkspace(pullInput)
          : await pullContent({
              ...pullInput,
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
