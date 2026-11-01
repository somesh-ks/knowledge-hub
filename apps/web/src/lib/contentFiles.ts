import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Where the site's content files come from (D173): the checkout at build time, or the content store
 * when a page is rendered on request (server/contentRepo.ts). The readers in digestFiles.ts,
 * episodes.ts and runState.ts take one of these, so one parser serves both.
 */
export interface ContentFiles {
  /** Every file under `directory`, by full path, sorted. Empty when there is none. */
  list(directory: string): Promise<string[]>;
  /** The file's text, or null when it does not exist. */
  read(path: string): Promise<string | null>;
}

export const diskFiles: ContentFiles = {
  async list(directory) {
    try {
      const entries = await readdir(directory, { recursive: true, withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name))
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  },
  async read(path) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  },
};

/** How many content files a reader asks for at once: enough to hide the round trip, few enough to be polite. */
export const READ_CONCURRENCY = 8;

/**
 * `task` for every item, at most `limit` at a time, the results in the items' order. The content
 * store answers each file with a request of its own, and a year of digests read one after another
 * would outlast the function's 20 seconds.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let index = next++; index < items.length; index = next++)
      results[index] = await task(items[index] as T);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
