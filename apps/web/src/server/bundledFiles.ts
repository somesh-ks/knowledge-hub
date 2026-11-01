import type { ContentFiles } from "../lib/contentFiles";
import { bundledStateFile } from "./stateSource";

/**
 * The content this build holds, as the page readers see it (ContentFiles). A page rendered on
 * request reads the content store; when the store cannot answer and this instance never read it,
 * the page is drawn from here instead of answering 503 (D282). Vite compiles every file under
 * Digests/ and Podcasts/ into the server build, one chunk per file, loaded only when read, so the
 * fallback costs nothing while the store is up.
 */
const REPO_ROOT = "../../../../";

const files = import.meta.glob<string>(
  [
    "../../../../Digests/**/*.md",
    "../../../../Digests/**/*.audio.json",
    "../../../../Podcasts/**/*.md",
  ],
  { query: "?raw", import: "default" },
);

const loaders = new Map(
  Object.entries(files).map(([key, load]) => [key.slice(REPO_ROOT.length), load]),
);

export const bundledContentFiles: ContentFiles = {
  async list(directory) {
    const prefix = `${directory.replace(/\/$/, "")}/`;
    return [...loaders.keys()].filter((path) => path.startsWith(prefix)).sort();
  },
  async read(path) {
    const load = loaders.get(path);
    return load ? await load() : bundledStateFile(path);
  },
};
