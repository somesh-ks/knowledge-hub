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
