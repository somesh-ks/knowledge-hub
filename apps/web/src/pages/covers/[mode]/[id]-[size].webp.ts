import { join } from "node:path";
import { COVER_MODES, type CoverMode } from "@singularity/cover";
import type { APIRoute, GetStaticPaths } from "astro";
import {
  COVER_SIZES,
  type CoverSize,
  type CoverSource,
  coverWebp,
  episodeCover,
  rendererFingerprint,
} from "../../../lib/covers";
import { findRepoRoot } from "../../../lib/repoRoot";
import { getSite } from "../../../lib/site";

interface Props {
  digest: CoverSource;
  size: CoverSize;
}

/** The covers the pages show, once for the light theme and once for the dark. */
export const getStaticPaths = (async () => {
  const { entries, episodes } = await getSite();
  const covers: CoverSource[] = [
    ...entries.map((entry) => entry.digest),
    ...episodes.map(episodeCover),
  ];
  return covers.flatMap((digest) =>
    COVER_MODES.flatMap((mode: CoverMode) =>
      COVER_SIZES.map((size) => ({
        params: { mode, id: digest.id, size: String(size) },
        props: { digest: { ...digest, mode }, size } satisfies Props,
      })),
    ),
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
