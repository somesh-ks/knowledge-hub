import type { APIRoute, GetStaticPaths } from "astro";
import { type CoverSource, coverLiveSvg, episodeCover } from "../../lib/covers";
import { getSite } from "../../lib/site";

interface Props {
  digest: CoverSource;
}

/** The live cover (D314) of every briefing and episode: the one drawing the page and the player recolour. */
export const getStaticPaths = (async () => {
  const { entries, episodes } = await getSite();
  const covers: CoverSource[] = [
    ...entries.map((entry) => entry.digest),
    ...episodes.map(episodeCover),
  ];
  return covers.map((digest) => ({
    params: { id: digest.id },
    props: { digest } satisfies Props,
  }));
}) satisfies GetStaticPaths;

export const GET: APIRoute<Props> = ({ props }) =>
  new Response(coverLiveSvg(props.digest), { headers: { "Content-Type": "image/svg+xml" } });
