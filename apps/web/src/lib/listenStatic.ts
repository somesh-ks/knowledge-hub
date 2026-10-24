import { briefingView, episodeView, type ListenView } from "../server/listenView";
import { getSite } from "./site";

/**
 * The listen page as the static test build draws it: one page per fixture briefing and episode at
 * /s/<item id>, since that build has no server to open a token (astro.config.mjs prerenders the page
 * there). The browser suite serves it for a token its own share route made. A real build has no
 * static listen page: every token is opened on the server.
 */
export async function staticListenPaths(): Promise<
  { params: { token: string }; props: { view: ListenView; lengthMs: number } }[]
> {
  const { entries, episodes, fixtures } = await getSite();
  if (!fixtures) return [];
  return [
    ...entries.map((entry) => ({
      params: { token: entry.id },
      props: { view: briefingView(entry.digest), lengthMs: entry.digest.listen_minutes * 60_000 },
    })),
    ...episodes.map((entry) => ({
      params: { token: entry.id },
      props: { view: episodeView(entry.episode), lengthMs: entry.episode.listen_minutes * 60_000 },
    })),
  ];
}
