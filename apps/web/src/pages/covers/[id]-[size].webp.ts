import { join } from "node:path";
import type { APIRoute, GetStaticPaths } from "astro";
import {
  COVER_SIZES,
  type CoverSize,
  type CoverSource,
  coverWebp,
  episodeCover,
  rendererFingerprint,
} from "../../lib/covers";
import { findRepoRoot } from "../../lib/repoRoot";
import { getSite } from "../../lib/site";

interface Props {
  digest: CoverSource;
  size: CoverSize;
}

/** The covers the pages show; the PNG route beside it serves the lock screen. */
export const getStaticPaths = (async () => {
  const { entries, episodes } = await getSite();
  // A briefing and an episode are drawn the same way. An episode is dated by when it was written.
  const covers: CoverSource[] = [
    ...entries.map((entry) => entry.digest),
    ...episodes.map(episodeCover),
  ];
  return covers.flatMap((digest) =>
    COVER_SIZES.map((size) => ({
      params: { id: digest.id, size: String(size) },
      props: { digest, size } satisfies Props,
    })),
  );
}) satisfies GetStaticPaths;

let fingerprint: Promise<string> | undefined;

/** Hashed once per build: the renderer's source, its palettes and its fonts. */
function currentFingerprint(root: string): Promise<string> {
  fingerprint ??= rendererFingerprint(
    [join(root, "packages", "cover", "src"), join(root, "packages", "cover", "fonts")],
    [join(root, "tokens", "covers.json")],
  );
  return fingerprint;
}

export const GET: APIRoute<Props> = async ({ props }) => {
  const root = findRepoRoot();
  const webp = await coverWebp(props.digest, props.size, {
    cacheDir: join(root, ".cache", "covers"),
    fingerprint: await currentFingerprint(root),
  });
  return new Response(webp, { headers: { "Content-Type": "image/webp" } });
};
