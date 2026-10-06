import { join } from "node:path";
import type { Digest } from "@dispatch/core";
import type { APIRoute, GetStaticPaths } from "astro";
import { COVER_SIZES, type CoverSize, coverPng, rendererFingerprint } from "../../lib/covers";
import { findRepoRoot } from "../../lib/repoRoot";
import { getSite } from "../../lib/site";

interface Props {
  digest: Digest;
  size: CoverSize;
}

export const getStaticPaths = (async () => {
  const { entries } = await getSite();
  return entries.flatMap((entry) =>
    COVER_SIZES.map((size) => ({
      params: { id: entry.id, size: String(size) },
      props: { digest: entry.digest, size } satisfies Props,
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
  const png = await coverPng(props.digest, props.size, {
    cacheDir: join(root, ".cache", "covers"),
    fingerprint: await currentFingerprint(root),
  });
  return new Response(png, { headers: { "Content-Type": "image/png" } });
};
