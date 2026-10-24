import type { Item } from "@singularity/core";
import { buildItems } from "../normalize/buildItem.js";
import { entryToRaw, loadFeed } from "./feedItems.js";
import type { SourceFetcher } from "./types.js";

export function releasesFeedUrl(repo: string): string {
  return `https://github.com/${repo}/releases.atom`;
}

/**
 * GitHub releases.atom. Entry titles are bare tags such as "v12.0.0", useless without the project
 * name, so the source name is prefixed unless the title already carries it.
 */
export const fetchGithub: SourceFetcher = async (source, window, deps): Promise<Item[]> => {
  const repo = source.options.repo;
  const url = source.feed_url ?? (repo ? releasesFeedUrl(repo) : undefined);
  if (!url) throw new Error(`source ${source.id} needs options.repo or feed_url`);
  const feed = await loadFeed(url, deps);
  const raws = feed.entries.map((entry) => {
    const raw = entryToRaw(entry);
    const title = entry.title ?? "";
    const named = title.toLowerCase().includes(source.name.toLowerCase());
    return { ...raw, title: named ? title : `${source.name}: ${title}` };
  });
  return buildItems(raws, { source, window, fetchedAt: deps.now() });
};
