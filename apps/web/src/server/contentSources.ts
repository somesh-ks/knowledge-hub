import { audioTimelineRelPath, digestRelPath } from "@dispatch/core";
import { type ContentRepoDeps, loadStoreFiles } from "./contentRepo";
import { bundledDigestIds, bundledDigests } from "./digestSource";
import { bundledEpisodeIds, bundledEpisodes } from "./episodeSource";
import type { DigestSource, EpisodeBundle } from "./narrate";

/**
 * The briefings and episodes as the API routes read them (D173): from the content repository, so
 * Play, Regenerate and Delete work on content newer than the last deploy. When the store cannot
 * answer (not configured, unreachable), a read falls back to this build's bundled copy, which is
 * what the routes read before. When it answers, it is the only answer: a deleted briefing is gone.
 *
 * The schedule is still the build's (config/, D149 moves it).
 */

const runtime = (): ContentRepoDeps => ({ env: process.env, fetch, now: Date.now });

/** The store's text at a repository path; undefined when the store cannot answer. */
async function storeRead(path: string, deps: ContentRepoDeps): Promise<string | null | undefined> {
  try {
    const files = await loadStoreFiles(deps);
    return files ? await files.read(path) : undefined;
  } catch (error) {
    console.error(
      `[content] store read failed, using the build's copy: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return undefined;
  }
}

/** The store's paths under a directory; undefined when the store cannot answer. */
async function storeList(directory: string, deps: ContentRepoDeps): Promise<string[] | undefined> {
  try {
    const files = await loadStoreFiles(deps);
    return files ? await files.list(directory) : undefined;
  } catch (error) {
    console.error(
      `[content] store list failed, using the build's copy: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return undefined;
  }
}

const idOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");

/** The ids of the `.md` files under a directory, newest first. */
const markdownIds = (paths: readonly string[]): string[] =>
  paths
    .filter((path) => path.endsWith(".md"))
    .map(idOf)
    .sort()
    .reverse();

export function contentDigests(deps: () => ContentRepoDeps = runtime): DigestSource {
  return {
    readSchedule: () => bundledDigests.readSchedule?.() ?? Promise.resolve(null),
    async readDigest(id) {
      const text = await storeRead(digestRelPath(id), deps());
      return text === undefined ? bundledDigests.readDigest(id) : text;
    },
    async readTimeline(id) {
      const text = await storeRead(audioTimelineRelPath(id), deps());
      if (text === undefined) return bundledDigests.readTimeline(id);
      if (text === null) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return null;
      }
    },
  };
}

export function contentEpisodes(deps: () => ContentRepoDeps = runtime): EpisodeBundle {
  return {
    async readEpisode(id) {
      // An episode's folder follows when it was written, not its id, so it is found by its name.
      const paths = await storeList("Podcasts", deps());
      if (paths === undefined) return bundledEpisodes.readEpisode(id);
      const path = paths.find((candidate) => candidate.endsWith(`/${id}.md`));
      return path ? ((await storeRead(path, deps())) ?? null) : null;
    },
  };
}

/** The id of every briefing, newest first. */
export async function contentDigestIds(deps: () => ContentRepoDeps = runtime): Promise<string[]> {
  const paths = await storeList("Digests", deps());
  return paths === undefined ? bundledDigestIds() : markdownIds(paths);
}

/** The id of every episode, newest first. */
export async function contentEpisodeIds(deps: () => ContentRepoDeps = runtime): Promise<string[]> {
  const paths = await storeList("Podcasts", deps());
  return paths === undefined ? bundledEpisodeIds() : markdownIds(paths);
}

/** The kind a briefing's front matter names, or null when there is no such briefing. */
export async function contentDigestKind(
  id: string,
  deps: () => ContentRepoDeps = runtime,
): Promise<string | null> {
  const text = await contentDigests(deps).readDigest(id);
  return text ? (/^kind:\s*(\S+)/m.exec(text)?.[1] ?? null) : null;
}
