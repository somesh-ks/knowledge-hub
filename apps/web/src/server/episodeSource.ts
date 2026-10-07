import type { EpisodeBundle } from "./narrate";

/**
 * The podcast episodes as the narrate function sees them: bundled, not read from disk, for the same
 * reason the digests are (see digestSource.ts). Vite compiles every file under Podcasts/ into the
 * server build, one small chunk per file, loaded only when a request asks for that episode.
 *
 * The folder does not exist until the first episode is committed. A glob with no match is an empty
 * object, so a build without episodes simply has none.
 *
 * The pattern has to be a literal. An episode's folder follows when it was written, which can be a
 * different month from the one in its id, so a file is found by its name and not by a path worked
 * out from the id.
 */
const episodeFiles = import.meta.glob<string>("../../../../Podcasts/**/*.md", {
  query: "?raw",
  import: "default",
});

function idOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
}

const loaders = new Map(Object.entries(episodeFiles).map(([path, load]) => [idOf(path), load]));

export const bundledEpisodes: EpisodeBundle = {
  async readEpisode(id) {
    const load = loaders.get(id);
    return load ? await load() : null;
  },
};

/** The id of every episode in this build, newest first. */
export function bundledEpisodeIds(): string[] {
  return [...loaders.keys()].sort().reverse();
}
