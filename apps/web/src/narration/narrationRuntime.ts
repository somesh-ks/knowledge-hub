/**
 * Narration on Play, assembled for the browser. Loaded on demand, the first time a listener presses
 * Play on a briefing that has no finished audio, so none of it weighs on an ordinary visit.
 */
import { parseStreamDoc, type StreamDoc } from "../lib/liveStream";
import { getPlayerAudio, getPlayerStore } from "../player/core/playerRuntime";
import { showToast } from "../sheets/toastStore";
import { liveDigestFrom } from "./liveEpisode";
import { createNarrationController, type NarrationController } from "./narrationController";
import { startPrewarm } from "./prewarmPage";

const PREPARING_LABEL = "Preparing audio";

/** Shows the briefing's Play control as busy while its first file is made, and settles it after. */
function setPreparing(digestId: string | null): void {
  for (const chip of document.querySelectorAll<HTMLElement>("[data-play-digest]")) {
    const label = chip.querySelector<HTMLElement>("[data-chip-label]");
    if (digestId !== null && chip.dataset.playDigest === digestId) {
      chip.dataset.restLabel ??= label?.textContent ?? "";
      chip.dataset.state = "preparing";
      chip.setAttribute("aria-busy", "true");
      if (label) label.textContent = PREPARING_LABEL;
    } else if (chip.dataset.restLabel !== undefined) {
      chip.removeAttribute("aria-busy");
      // Once the briefing plays, the player has written the chip itself; only an attempt that
      // stopped short is put back as it was.
      if (chip.dataset.state === "preparing" && !getPlayerStore().getPageDigest()?.audio) {
        chip.dataset.state = "idle";
        if (label) label.textContent = chip.dataset.restLabel;
      }
      delete chip.dataset.restLabel;
    }
  }
}

let controller: NarrationController | null = null;

function getController(): NarrationController {
  controller ??= createNarrationController({
    store: getPlayerStore(),
    audio: getPlayerAudio(),
    api: {
      fetch: (input, init) => fetch(input, init),
      isOnline: () => navigator.onLine,
      shareToken,
    },
    notify: (message) => showToast({ message }),
    setPreparing,
  });
  return controller;
}

/**
 * The token of a shared page showing this briefing (DigestView and EpisodeView mark it), else null.
 * Read from the address the page was opened at, /s/<token>.
 */
function shareToken(digestId: string): string | null {
  const [route, token] = location.pathname.split("/").filter(Boolean);
  if (route !== "s" || !token) return null;
  for (const main of document.querySelectorAll<HTMLElement>("main[data-shared]")) {
    if (main.dataset.digestId === digestId) return token;
  }
  return null;
}

/** Asks for the first segments of a page's briefing in the background. Silent whatever happens. */
export function prewarmPage(): Promise<void> {
  const page = getPlayerStore().getPageDigest();
  // Read again now: the listener may have moved on, or the audio may have arrived meanwhile. A
  // shared page never prewarms: its lookup is a play start, counted against the link's caps.
  if (!page || page.audio || shareToken(page.id) || !startPrewarm(page.id)) {
    return Promise.resolve();
  }
  return getController().prewarm(page);
}

/**
 * Plays an episode that is still being written, from its live copy (liveEpisode.ts). The player is
 * the persistent one, so this works from any page; there is no episode page for it yet.
 */
export function narrateLive(doc: StreamDoc, runId: number): void {
  void getController().play(liveDigestFrom(doc, new Date()), undefined, {
    status: doc.status,
    fetchDoc: async () => {
      // The run indicator's route: the same copy, by the run that is writing it.
      const res = await fetch(`/api/stream?run=${runId}`, { cache: "no-store" }).catch(() => null);
      return res?.ok ? parseStreamDoc(await res.text()) : null;
    },
    delay: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    now: Date.now,
  });
}

/** Plays the briefing on this page, narrating what is missing. */
export function narratePage(itemId?: string): void {
  const page = getPlayerStore().getPageDigest();
  if (!page) return;
  void getController().play(page, itemId);
}
