/**
 * Pre-narrates a new episode's first turns the moment the run indicator sees it go live, so the
 * listener's first Play finds files instead of waiting for speech. Loaded on demand by the run
 * indicator only. It goes through the same /api/narrate calls as a press, so the server's daily cap
 * and monthly budget apply exactly as they would to Play; a refusal or a failure ends it in silence.
 */
import { OPEN_PASSPHRASE, PASSPHRASE_REQUIRED } from "../lib/access";
import { safeLocalStorage } from "../player/core/resume";
import { type ApiDeps, lookupNarration, narrateSegment } from "./narrationApi";
import { createOpenPassphraseMemory, createPassphraseMemory } from "./passphraseMemory";
import { startPrewarm } from "./prewarmPage";

/** The turns asked for: the opening, then the next one, as the page prewarm does. */
export const EPISODE_PREWARM_SEGMENTS = 2;

export interface EpisodePrewarmDeps {
  api: ApiDeps;
  /** The passphrase the listener already gave, or null: a prewarm never asks for one. */
  passphrase(): string | null;
  /** The browser allows a background request and this tab has not tried this id yet. */
  allowed(id: string): boolean;
}

function browserDeps(): EpisodePrewarmDeps {
  const memory = PASSPHRASE_REQUIRED
    ? createPassphraseMemory(safeLocalStorage())
    : createOpenPassphraseMemory(OPEN_PASSPHRASE);
  return {
    api: { fetch: (input, init) => fetch(input, init), isOnline: () => navigator.onLine },
    passphrase: memory.get,
    allowed: startPrewarm,
  };
}

/** One lookup, then the first turns one after the other. Never throws, never tells the listener. */
export async function prewarmEpisode(id: string, deps?: EpisodePrewarmDeps): Promise<void> {
  try {
    const use = deps ?? browserDeps();
    const passphrase = use.passphrase();
    if (passphrase === null || !use.allowed(id)) return;
    const lookup = await lookupNarration(id, use.api);
    if (!lookup.ok || lookup.whole) return;
    for (const segment of lookup.segments.slice(0, EPISODE_PREWARM_SEGMENTS)) {
      if (segment.audio?.confirmed) continue;
      // One at a time, as the page sends them; a refusal (the cap, the budget) stops it at once.
      const made = await narrateSegment(id, segment.key, passphrase, use.api);
      if (!made.ok) return;
    }
  } catch {
    // A prewarm is never worth an error.
  }
}
