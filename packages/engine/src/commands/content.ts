import { type CommandContext, type CommandRun, secretsFromEnv } from "../context.js";
import { emit } from "../curate/output.js";
import { describeError } from "../llm/errors.js";
import { type BlobClient, createVercelBlobClient } from "../publish/blob.js";
import { syncContent } from "../publish/contentSync.js";

export const CONTENT_USAGE = "Usage: singularity content sync";

export interface ContentDeps {
  blob?: BlobClient;
  fetchText?: (url: string) => Promise<string | null>;
}

async function fetchText(url: string): Promise<string | null> {
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Store read failed: HTTP ${res.status}`);
  return await res.text();
}

/** `singularity content sync`: mirror the content files of the checkout into the content store (D173). */
export function makeContentCommand(deps: ContentDeps = {}): CommandRun {
  return async (argv, ctx: CommandContext) => {
    if (argv.length !== 1 || argv[0] !== "sync") {
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
      ctx.log.error(`content sync failed: ${describeError(error, secretsFromEnv(ctx.env))}`);
      return 1;
    }
  };
}

export const run: CommandRun = makeContentCommand();
