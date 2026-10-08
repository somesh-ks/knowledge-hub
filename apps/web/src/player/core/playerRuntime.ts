/**
 * Wires the player to the page: the audio store (a module singleton, so playback outlives any
 * island), Media Session, the reader coupling, announcements, sounds, theme and root attributes.
 *
 * `getPlayerStore()` is cheap and safe to call from render. `startPlayerRuntime()` attaches the
 * listeners and returns a teardown, so React StrictMode's start, stop, start in development leaves
 * exactly one set of listeners behind.
 */

import { narratedOrPage } from "../../narration/narrationRegistry";
import { createSwitchableAudio, type SwitchableAudio } from "../../narration/switchableAudio";
import { startSound } from "../sound/soundController";
import { announcementForEvent } from "./announcements";
import { announce } from "./announcerDom";
import { readDigestData } from "./digestData";
import { recordInstallVisit } from "./installHint";
import { attachMediaSession } from "./mediaSession";
import { shouldToggleOnPageSpace } from "./playerKeys";
import { playerSheet } from "./playerSheet";
import { createPlayerStore } from "./playerStore";
import type { PlayerStore } from "./playerTypes";
import { getPreferences } from "./preferences";
import { createReaderSync } from "./readerSync";
import { safeLocalStorage } from "./resume";
import { reapplyRootState, setRootAttribute, setRootProperty } from "./rootAttributes";
import { reapplyTheme, startThemeSync } from "./themeRuntime";

const PREWARM_DELAY_MS = 1_500;

let store: PlayerStore | null = null;

function onPageHide(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onVisibility = (): void => {
    if (document.hidden) callback();
  };
  window.addEventListener("pagehide", callback);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    window.removeEventListener("pagehide", callback);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

let playerAudio: SwitchableAudio | null = null;

/**
 * The one audio element, behind a seam (see narration/switchableAudio.ts). Created in script and
 * never placed in the DOM, so a router that swaps the page cannot take it down with the markup.
 */
export function getPlayerAudio(): SwitchableAudio {
  playerAudio ??= createSwitchableAudio(new Audio());
  return playerAudio;
}

/** A tap on Play for a briefing with no finished audio: unlock the element now, narrate next. */
function narrateFromTap(itemId?: string): void {
  // Inside the tap, so a phone lets the audio start a few seconds later without another one.
  getPlayerAudio().prime("/silence.wav");
  void import("../../narration/narrationRuntime").then((narration) =>
    narration.narratePage(itemId),
  );
}

export function getPlayerStore(): PlayerStore {
  store ??= createPlayerStore({
    createAudio: getPlayerAudio,
    storage: safeLocalStorage(),
    getPreferredRate: () => getPreferences().get().rate,
    onRateChange: (rate) => {
      const preferred = getPreferences();
      if (rate === 1 || rate === 1.25 || rate === 1.5 || rate === 2) preferred.set({ rate });
    },
    onPageHide,
  });
  return store;
}

function syncRootState(playerStore: PlayerStore): void {
  const state = playerStore.getState();
  setRootAttribute("data-player-state", state.status);
  setRootAttribute("data-mini", state.hasStarted ? "visible" : "hidden");
  setRootProperty("--cover-key", state.track?.digest.cover.key ?? null);
}

/** Reads the page's digest into the store and refreshes the reader coupling. */
function readPage(playerStore: PlayerStore): void {
  // A briefing narrated earlier in this session comes back with its audio, not as the page built it.
  playerStore.setPageDigest(narratedOrPage(readDigestData()));
}

/** A dialog or popover other than the player is open. The toast is a popover, but not a modal one. */
function otherOverlayOpen(): boolean {
  try {
    return document.querySelector("dialog[open], [popover]:popover-open:not(.toast)") !== null;
  } catch {
    // Safari before 17 does not know :popover-open.
    return document.querySelector("dialog[open]") !== null;
  }
}

/** Space plays and pauses from anywhere on the page once the bar is there. */
function toggleOnSpace(playerStore: PlayerStore): (event: KeyboardEvent) => void {
  return (event) => {
    const state = playerStore.getState();
    const loaded = state.hasStarted && Boolean(state.track?.digest.audio);
    const target = event.target instanceof Element ? event.target : null;
    if (!shouldToggleOnPageSpace(event, target, { loaded, overlayOpen: otherOverlayOpen() }))
      return;
    // Only when it acts: otherwise Space stays the page's scroll key.
    event.preventDefault();
    playerStore.toggle();
  };
}

export function startPlayerRuntime(): () => void {
  const playerStore = getPlayerStore();
  const preferences = getPreferences();
  recordInstallVisit(safeLocalStorage());

  const detachMediaSession = attachMediaSession(playerStore);
  const reader = createReaderSync(playerStore, narrateFromTap);
  const stopSound = startSound({ store: playerStore, preferences });

  const stopTheme = startThemeSync();

  syncRootState(playerStore);
  const offState = playerStore.subscribe(() => syncRootState(playerStore));
  const offEvent = playerStore.onEvent((event) => {
    const message = announcementForEvent(event, playerStore.getState().track);
    if (message) announce(message);
  });

  const onPageLoad = (): void => {
    readPage(playerStore);
    reader.refresh();
    if (navigator.onLine && !playerStore.getPageDigest()?.audio) {
      // A moment after the page settles, so it never competes with the first load.
      setTimeout(() => {
        import("../../narration/narrationRuntime")
          .then((narration) => narration.prewarmPage())
          .catch(() => undefined);
      }, PREWARM_DELAY_MS);
    }
  };
  // A navigation never happens under an open player: the page goes down in one step first.
  // Never preventDefault here; that turns the navigation into a full load and stops the audio.
  const onBeforeNavigation = (): void => playerSheet.collapseNow();
  const onAfterSwap = (): void => {
    // The safety net for a navigation that announced nothing: no modal over a new document.
    playerSheet.collapseNow();
    reapplyRootState();
    reapplyTheme();
    playerSheet.sync();
  };
  const onSpace = toggleOnSpace(playerStore);
  const onOnline = (): void => announce("You are back online.");
  const onOffline = (): void => announce("You are offline.");

  document.addEventListener("astro:page-load", onPageLoad);
  document.addEventListener("astro:before-preparation", onBeforeNavigation);
  document.addEventListener("astro:after-swap", onAfterSwap);
  document.addEventListener("keydown", onSpace);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  // The island usually hydrates after the first astro:page-load has already fired.
  onPageLoad();

  return () => {
    document.removeEventListener("astro:page-load", onPageLoad);
    document.removeEventListener("astro:before-preparation", onBeforeNavigation);
    document.removeEventListener("astro:after-swap", onAfterSwap);
    document.removeEventListener("keydown", onSpace);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    offEvent();
    offState();
    stopTheme();
    stopSound();
    reader.destroy();
    detachMediaSession();
  };
}
