import type { SourceType } from "@singularity/core";
import { fetchArxiv } from "./arxiv.js";
import { fetchCrossref } from "./crossref.js";
import { fetchExa } from "./exa.js";
import { fetchFirecrawl } from "./firecrawl.js";
import { fetchGithub } from "./github.js";
import { fetchHn } from "./hn.js";
import { fetchLobsters } from "./lobsters.js";
import { fetchProductHunt } from "./producthunt.js";
import { fetchRss } from "./rss.js";
import type { SourceFetcher } from "./types.js";
import { fetchYoutube } from "./youtube.js";

/** One fetcher per source type. Adding a type to core makes this fail to compile until handled. */
export const FETCHERS: Record<SourceType, SourceFetcher> = {
  rss: fetchRss,
  github: fetchGithub,
  hn: fetchHn,
  youtube: fetchYoutube,
  exa: fetchExa,
  firecrawl: fetchFirecrawl,
  crossref: fetchCrossref,
  arxiv: fetchArxiv,
  lobsters: fetchLobsters,
  producthunt: fetchProductHunt,
};
