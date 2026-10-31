/**
 * What has been narrated on Play in this session, kept where the page's own code can reach it
 * without loading the narration code.
 *
 * A page describes its briefing as it was built: no audio. Once a listener has started narrating
 * that briefing, the player holds a richer copy with a source and story marks. If the listener
 * leaves and comes back, the page hands the player its plain copy again, which would stop the audio
 * and drop the marks. So the player runtime passes every page briefing through `narratedOrPage`
 * first, and gets the richer copy back whenever there is one.
 */
import { tabShared } from "../player/core/tabSlot";
import type { PlayerDigestData } from "../types/contracts";

/** One per tab, so a second copy of the bundle (after a deploy) sees what the first narrated. */
const narrated = tabShared("narrated", () => new Map<string, PlayerDigestData>());

export function rememberNarrated(digest: PlayerDigestData): void {
  narrated.set(digest.id, digest);
}

export function forgetNarrated(digestId: string): void {
  narrated.delete(digestId);
}

/** The narrated copy of a page's briefing when there is one, otherwise the page's own. */
export function narratedOrPage(digest: PlayerDigestData): PlayerDigestData;
export function narratedOrPage(digest: PlayerDigestData | null): PlayerDigestData | null;
export function narratedOrPage(digest: PlayerDigestData | null): PlayerDigestData | null {
  if (!digest) return null;
  // A page that carries finished audio is newer than anything narrated in this session.
  if (digest.audio) return digest;
  return narrated.get(digest.id) ?? digest;
}
