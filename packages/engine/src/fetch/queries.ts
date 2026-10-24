import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Category, IdString } from "@singularity/core";
import { z } from "zod";

export const ExaQuery = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  /** Natural language. Freshness comes from the fetch window, so years never appear here. */
  query: z.string().min(1),
  include_domains: z.array(z.string().min(1)).optional(),
  category_hint: Category.optional(),
  /** Custom topic the query was written for. Its results are judged against that topic. */
  topic_id: IdString.optional(),
});
export type ExaQuery = z.infer<typeof ExaQuery>;

/** Shape of config/queries.json. */
export const QueriesFile = z.object({
  version: z.literal(1),
  queries: z.array(ExaQuery),
});
export type QueriesFile = z.infer<typeof QueriesFile>;

export const QUERIES_PATH = "config/queries.json";

export function parseQueries(json: unknown): QueriesFile {
  return QueriesFile.parse(json);
}

/** Missing file means no discovery queries, not an error. */
export async function loadQueries(root: string): Promise<QueriesFile> {
  let text: string;
  try {
    text = await readFile(join(root, QUERIES_PATH), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, queries: [] };
    throw error;
  }
  return parseQueries(JSON.parse(text) as unknown);
}
