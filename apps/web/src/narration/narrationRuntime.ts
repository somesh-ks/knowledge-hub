/**
 * Narration on Play, assembled for the browser. Loaded on demand, the first time a listener presses
 * Play on a briefing that has no finished audio, so none of it weighs on an ordinary visit.
 */
import { OPEN_PASSPHRASE, PASSPHRASE_REQUIRED } from "../lib/access";
import { getPlayerAudio, getPlayerStore } from "../player/core/playerRuntime";
import { safeLocalStorage } from "../player/core/resume";
import { showToast } from "../sheets/toastStore";
import type { PlayerDigestData } from "../types/contracts";
import { createNarrationController, type NarrationController } from "./narrationController";
import { createOpenPassphraseMemory, createPassphraseMemory } from "./passphraseMemory";
import { askPassphrase } from "./passphrasePrompt";

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
    api: { fetch: (input, init) => fetch(input, init), isOnline: () => navigator.onLine },
    // With the passphrase step off, the fixed value is always at hand and the sheet is never opened.
    passphrase: PASSPHRASE_REQUIRED
      ? createPassphraseMemory(safeLocalStorage())
      : createOpenPassphraseMemory(OPEN_PASSPHRASE),
    askPassphrase,
    notify: (message) => showToast({ message }),
    setPreparing,
  });
  return controller;
}

/** Asks for the first segments of a page's briefing in the background. Silent whatever happens. */
export function prewarmPage(page: PlayerDigestData): Promise<void> {
  return getController().prewarm(page);
}

/** Plays the briefing on this page, narrating what is missing. */
export function narratePage(itemId?: string): void {
  const page = getPlayerStore().getPageDigest();
  if (!page) return;
  void getController().play(page, itemId);
}
