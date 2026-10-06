import { parseArgs } from "node:util";
import type { Item } from "@dispatch/core";
import { type CommandRun, redact, secretsFromEnv } from "../context.js";
import { loadPool } from "../curate/inputs.js";
import { resolveRunLocation } from "../curate/runDir.js";
import { type ExtractedText, extractFullText } from "../extract/extractText.js";
import { createFirecrawlScrape } from "../extract/firecrawlScrape.js";
import { truncateAtParagraph } from "../extract/truncate.js";

const USAGE =
  "Usage: dispatch extract --ids <a,b,c> [--pool <path>] [--run <id>] [--max-chars <n>]";

/** Total characters printed across all items, so one call cannot flood a session's context. */
export const DEFAULT_TOTAL_CHARS = 60_000;

export type ExtractFn = (item: Item) => Promise<ExtractedText | null>;

export interface ExtractResult {
  /** Item id to extracted text, within the total cap. */
  texts: Record<string, string>;
  /** Ids the pool does not contain. */
  unknown: string[];
  /** Ids with no readable source text. */
  unreadable: string[];
  /** Ids left out or cut because the total cap was reached. */
  capped: string[];
}

/**
 * Extract text for the named pool items in the order given, spending the total character budget
 * front to back: an item that does not fit whole is cut at a paragraph boundary, and items after
 * the budget is gone are listed instead of printed.
 */
export async function extractIds(
  ids: readonly string[],
  pool: readonly Item[],
  extract: ExtractFn,
  totalChars: number,
): Promise<ExtractResult> {
  const byId = new Map(pool.map((item) => [item.id, item]));
  const result: ExtractResult = { texts: {}, unknown: [], unreadable: [], capped: [] };
  let remaining = totalChars;
  for (const id of new Set(ids)) {
    const item = byId.get(id);
    if (!item) {
      result.unknown.push(id);
      continue;
    }
    const extracted = await extract(item);
    if (!extracted) {
      result.unreadable.push(id);
      continue;
    }
    if (remaining <= 0) {
      result.capped.push(id);
      continue;
    }
    const cut = truncateAtParagraph(extracted.text, remaining);
    result.texts[id] = cut.text;
    remaining -= cut.text.length;
    if (cut.truncated && cut.text.length < extracted.text.length && remaining <= 0) {
      result.capped.push(id);
    }
  }
  return result;
}

/**
 * `dispatch extract --ids a,b,c`: full text for chosen pool items, for a Claude Code session that
 * curates by hand. Prints one JSON object from item id to text on stdout; everything else goes to
 * stderr. Uses the network (page fetches, and Firecrawl when FIRECRAWL_API_KEY is set).
 */
export function makeExtractCommand(
  createExtract?: (ctx: Parameters<CommandRun>[1]) => ExtractFn,
): CommandRun {
  return async (argv, ctx) => {
    let values: {
      ids?: string | undefined;
      pool?: string | undefined;
      run?: string | undefined;
      "max-chars"?: string | undefined;
    };
    try {
      values = parseArgs({
        args: argv,
        allowPositionals: false,
        strict: true,
        options: {
          ids: { type: "string" },
          pool: { type: "string" },
          run: { type: "string" },
          "max-chars": { type: "string" },
        },
      }).values;
    } catch (error) {
      ctx.log.error(`${error instanceof Error ? error.message : "invalid arguments"}. ${USAGE}`);
      return 2;
    }
    const ids = (values.ids ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    if (ids.length === 0) {
      ctx.log.error(`--ids needs at least one item id. ${USAGE}`);
      return 2;
    }
    const totalChars =
      values["max-chars"] === undefined ? DEFAULT_TOTAL_CHARS : Number(values["max-chars"]);
    if (!Number.isInteger(totalChars) || totalChars < 1) {
      ctx.log.error(`--max-chars needs a whole number of at least 1. ${USAGE}`);
      return 2;
    }

    try {
      const location = await resolveRunLocation(ctx.root, { run: values.run, pool: values.pool });
      const pool = await loadPool(location.poolPath);
      const extract =
        createExtract?.(ctx) ??
        ((item: Item) =>
          extractFullText(item, {
            scrape: ctx.env.FIRECRAWL_API_KEY
              ? createFirecrawlScrape({ apiKey: ctx.env.FIRECRAWL_API_KEY })
              : null,
            log: ctx.log,
          }));
      const result = await extractIds(ids, pool.items, extract, totalChars);
      if (result.unknown.length > 0) {
        ctx.log.warn(`Not in the pool: ${result.unknown.join(", ")}`);
      }
      if (result.unreadable.length > 0) {
        ctx.log.warn(`No readable text for: ${result.unreadable.join(", ")}`);
      }
      if (result.capped.length > 0) {
        ctx.log.warn(
          `Cut or left out at the ${totalChars} character cap: ${result.capped.join(", ")}`,
        );
      }
      process.stdout.write(`${JSON.stringify(result.texts)}\n`);
      return 0;
    } catch (error) {
      const message =
        error instanceof Error ? (error.message.split("\n")[0] ?? "failed") : "failed";
      ctx.log.error(redact(message, secretsFromEnv(ctx.env)));
      return 1;
    }
  };
}

export const run: CommandRun = makeExtractCommand();
