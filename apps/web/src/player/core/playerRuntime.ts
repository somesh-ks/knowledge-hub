/**
 * Wires the player to the page: the audio store (a module singleton, so playback outlives any
 * island), Media Session, the reader coupling, announcements, sounds, theme and root attributes.
 *
 * `getPlayerStore()` is cheap and safe to call from render. `startPlayerRuntime()` attaches the
 * listeners and returns a teardown, so React StrictMode's start, stop, start in development leaves
 * exactly one set of listeners behind.
 */

import { narratedOrPage } from "../../narration/narrationRegistry";
import { pageNeedsPrewarm, whenIdle } from "../../narration/prewarmPage";
import { createSwitchableAudio, type SwitchableAudio } from "../../narration/switchableAudio";
import { startSound } from "../sound/soundController";
import { announcementForEvent } from "./announcements";
import { announce } from "./announcerDom";

/** The open player covers the page (html[data-player="open"]), so the page's own notices are inert. */
function playerIsOpen(): boolean {
  return document.documentElement.getAttribute("data-player") === "open";
}

import { readDigestData } from "./digestData";
import { replayEarlyTap, takeEarlyAudio } from "./earlyTap";
import { attachMediaSession } from "./mediaSession";
import { directionBetween, navigateTo } from "./navigation";
import { shouldToggleOnPageSpace } from "./playerKeys";
import { playerSheet } from "./playerSheet";
import { createPlayerStore } from "./playerStore";
import type { PlayerStore } from "./playerTypes";
import {
  createPlayQueue,
  isQueueId,
  type PlayQueue,
  QUEUE_ADD_EVENT,
  QUEUE_CHANGED_EVENT,
  queueItemUrl,
} from "./playQueue";
import { getPreferences, rememberRate } from "./preferences";
import { createReaderSync, type ReaderSync } from "./readerSync";
import { safeLocalStorage } from "./resume";
import { reapplyRootState, setRootAttribute, setRootProperty } from "./rootAttributes";
import { reapplyTheme, startThemeSync } from "./themeRuntime";

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
  // The element a Play pressed before the player loaded has already unlocked, when there is one.
  playerAudio ??= createSwitchableAudio(takeEarlyAudio() ?? new Audio());
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

/**
 * A story row or Previous and Next on a recording whose narration is not laid out yet: start the
 * page's recording at that story, narrating what is missing. Does nothing when the page holds
 * another recording than the player shows.
 */
export function playPageStory(digestId: string, itemId: string): void {
  const page = getPlayerStore().getPageDigest();
  if (!page || page.id !== digestId || page.audio) return;
  narrateFromTap(itemId);
}

let activeReader: ReaderSync | null = null;

/**
 * Plays a briefing the listener is being taken to (Up next): the same road as a cover press, so one
 * with no finished audio is narrated once its page has loaded.
 */
export function playBriefingOnArrival(digestId: string): void {
  activeReader?.expectPage(digestId);
  getPlayerStore().playWhenPageLoads(digestId);
}

let queue: PlayQueue | null = null;

/** The listener's queue (playQueue.ts). Every change is told to the page as dispatch:queue-changed. */
export function getPlayQueue(): PlayQueue {
  queue ??= createPlayQueue({
    storage: safeLocalStorage(),
    // Only an item that has started counts as now playing: one a page merely loaded, idle, can
    // still be queued.
    getCurrentId: () => {
      const state = getPlayerStore().getState();
      return state.hasStarted ? (state.track?.digest.id ?? null) : null;
    },
    onChange: (ids) => {
      document.dispatchEvent(new CustomEvent(QUEUE_CHANGED_EVENT, { detail: { ids: [...ids] } }));
    },
  });
  return queue;
}

/**
 * Plays a queued item (or any briefing or episode) now: off the queue, then the road Up next takes.
 * The item's page brings its data; the store plays it on arrival, on the audio element the browser
 * already trusts. The player goes down first, as before every navigation.
 */
export function playQueueItem(id: string): void {
  const current = getPlayerStore().getState().track?.digest.id ?? null;
  getPlayQueue().remove(id);
  playBriefingOnArrival(id);
  void playerSheet
    .collapse()
    .then(() => navigateTo(queueItemUrl(id), { direction: directionBetween(current, id) }));
}

export function getPlayerStore(): PlayerStore {
  store ??= createPlayerStore({
    createAudio: getPlayerAudio,
    storage: safeLocalStorage(),
    getPreferredRate: () => getPreferences().get().rate,
    onRateChange: (rate) => rememberRate(getPreferences(), rate),
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
    // Before anything has played, a briefing or episode page's own Play is what Space presses, so
    // a recording with no audio yet is narrated as a tap would narrate it.
    const pagePlay = loaded
      ? null
      : document.querySelector<HTMLElement>("[data-play-digest]:not([aria-disabled='true'])");
    const target = event.target instanceof Element ? event.target : null;
    const context = { loaded: loaded || pagePlay !== null, overlayOpen: otherOverlayOpen() };
    if (!shouldToggleOnPageSpace(event, target, context)) return;
    // Only when it acts: otherwise Space stays the page's scroll key.
    event.preventDefault();
    if (pagePlay) pagePlay.click();
    else playerStore.toggle();
  };
}

export function startPlayerRuntime(): () => void {
  const playerStore = getPlayerStore();
  const preferences = getPreferences();
  // Counted for the install hint on Settings; nothing on this page waits on it, so it loads late.
  whenIdle(() => {
    import("./installHint")
      .then((hint) => hint.recordInstallVisit(safeLocalStorage()))
      .catch(() => undefined);
  });

  const detachMediaSession = attachMediaSession(playerStore);
  const reader = createReaderSync(playerStore, narrateFromTap);
  activeReader = reader;
  const stopSound = startSound({ store: playerStore, preferences });

  const stopTheme = startThemeSync();

  syncRootState(playerStore);
  // "Playing." waits for the sound: a start that fails at once (offline) says only why.
  let starting: string | null = null;
  const offState = playerStore.subscribe(({ status }) => {
    syncRootState(playerStore);
    if (status === "loading") return;
    if (starting && status === "playing") announce(starting);
    starting = null;
  });
  const playQueue = getPlayQueue();
  // The Library's card menu adds to the queue with an event, so it needs none of the player's code.
  const onQueueAdd = (event: Event): void => {
    const detail = (event as CustomEvent<{ id?: unknown; added?: boolean }>).detail;
    // The menu reads `added` once the event returns, so its toast says what happened.
    if (detail && isQueueId(detail.id)) detail.added = playQueue.add(detail.id);
  };
  // What starts playing is no longer to come, however it was started. A page that only loads an
  // item, idle, leaves it in the queue (an item opened from the Library stays queued).
  let startedId: string | null = null;
  const offQueueState = playerStore.subscribe(({ track, status }) => {
    const id = track?.digest.id ?? null;
    if (status !== "playing" || id === startedId) return;
    startedId = id;
    if (id) playQueue.started(id);
  });
  const offQueueEnd = playerStore.onEvent((event) => {
    if (event.type !== "ended") return;
    // The listener chose what comes next, so it starts by itself. With nothing queued, Up next only
    // offers the previous briefing.
    const next = playQueue.shift(playerStore.getState().track?.digest.id ?? null);
    if (next) playQueueItem(next);
  });
  const offEvent = playerStore.onEvent((event) => {
    const message = announcementForEvent(event, playerStore.getState().track, {
      open: playerIsOpen(),
      started: playerStore.getState().hasStarted,
    });
    if (event.type === "willPlay") starting = message;
    else if (message) announce(message);
  });

  const onPageLoad = (): void => {
    readPage(playerStore);
    reader.refresh();
    // Only a briefing or an episode without audio, at the next idle moment rather than after a
    // fixed wait: the first Play after a page opens finds its first file sooner.
    if (pageNeedsPrewarm(playerStore.getPageDigest(), navigator.onLine)) {
      whenIdle(() => {
        import("../../narration/narrationRuntime")
          .then((narration) => narration.prewarmPage())
          .catch(() => undefined);
      });
    }
  };
  // Browser Back (system Back on a phone) dismisses the open player and stays on the page. The open
  // player takes one history entry, as the Create sheet does (createSheet.ts): the head script
  // (themeInit.js) asks first on every pop, and answering "handled" keeps the router out of it.
  let entry = false;
  let wasOpen = false;
  const onBack = (event: Event): void => {
    if (!entry) return;
    entry = false;
    event.preventDefault();
    removeEventListener("dispatch:back", onBack);
    if (playerSheet.getSnapshot().open) void playerSheet.collapse();
  };
  // The navigation is already on its way; giving the entry back would turn it around.
  const dropEntry = (): void => {
    if (!entry) return;
    entry = false;
    removeEventListener("dispatch:back", onBack);
  };
  const offEntry = playerSheet.subscribe(() => {
    const open = playerSheet.getSnapshot().open;
    if (open === wasOpen) return;
    wasOpen = open;
    if (open) {
      history.pushState({ ...history.state, playerOpen: true }, "");
      entry = true;
      addEventListener("dispatch:back", onBack);
    } else if (entry) {
      // Closed any other way: give the entry back. The pop this causes reaches onBack, which swallows it.
      history.go(-1);
    }
  });
  // A navigation never happens under an open player: the page goes down in one step first.
  // Never preventDefault here; that turns the navigation into a full load and stops the audio.
  const onBeforeNavigation = (): void => {
    dropEntry();
    playerSheet.collapseNow();
  };
  const onAfterSwap = (): void => {
    // The safety net for a navigation that announced nothing: no modal over a new document.
    dropEntry();
    playerSheet.collapseNow();
    reapplyRootState();
    reapplyTheme();
    playerSheet.sync();
  };
  const onSpace = toggleOnSpace(playerStore);
  // The page's banner (role status) speaks the connection, except while the open player makes it
  // inert: only then does the player say it.
  const onOnline = (): void => {
    if (playerIsOpen()) announce("You are back online.");
    // A failure the lost connection caused happened while the listener was playing: play on.
    if (playerStore.getState().error?.kind === "offline") playerStore.retry();
  };
  const onOffline = (): void => {
    if (playerIsOpen()) announce("You are offline.");
  };

  document.addEventListener("astro:page-load", onPageLoad);
  document.addEventListener("astro:before-preparation", onBeforeNavigation);
  document.addEventListener("astro:after-swap", onAfterSwap);
  document.addEventListener("keydown", onSpace);
  document.addEventListener(QUEUE_ADD_EVENT, onQueueAdd);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  // The island usually hydrates after the first astro:page-load has already fired.
  onPageLoad();
  // A Play pressed while the player was loading is pressed again, now that it has a listener.
  replayEarlyTap();

  return () => {
    document.removeEventListener("astro:page-load", onPageLoad);
    document.removeEventListener("astro:before-preparation", onBeforeNavigation);
    document.removeEventListener("astro:after-swap", onAfterSwap);
    document.removeEventListener("keydown", onSpace);
    document.removeEventListener(QUEUE_ADD_EVENT, onQueueAdd);
    offQueueState();
    offQueueEnd();
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    offEvent();
    offState();
    offEntry();
    removeEventListener("dispatch:back", onBack);
    stopTheme();
    stopSound();
    if (activeReader === reader) activeReader = null;
    reader.destroy();
    detachMediaSession();
  };
}
