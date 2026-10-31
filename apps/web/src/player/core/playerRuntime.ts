/**
 * Wires the player to the page: the audio store (one per tab, so playback outlives any
 * island), Media Session, the reader coupling, announcements, sounds, theme and root attributes.
 *
 * `getPlayerStore()` is cheap and safe to call from render. `startPlayerRuntime()` attaches the
 * listeners and returns a teardown, so React StrictMode's start, stop, start in development leaves
 * exactly one set of listeners behind.
 */

import { track } from "../../lib/analytics";
import { narratedOrPage } from "../../narration/narrationRegistry";
import { pageNeedsPrewarm, whenIdle } from "../../narration/prewarmPage";
import { createSwitchableAudio, type SwitchableAudio } from "../../narration/switchableAudio";
import { wakeIslands } from "../../scripts/islandWake";
import type { PlayerDigestData } from "../../types/contracts";
import { startSound } from "../sound/soundController";
import { announcementForEvent } from "./announcements";
import { announce } from "./announcerDom";

/** The open player covers the page (html[data-player="open"]), so the page's own notices are inert. */
function playerIsOpen(): boolean {
  return document.documentElement.getAttribute("data-player") === "open";
}

import { readDigestData } from "./digestData";
import { replayEarlyTap, takeEarlyAudio } from "./earlyTap";
import { countListening } from "./listenEvents";
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
  takeNext,
} from "./playQueue";
import { getPreferences } from "./preferences";
import { loadQueueDigest, queueDigestFor } from "./queueMeta";
import { startQueuePrefetch } from "./queuePrefetch";
import { createReaderSync, type ReaderSync } from "./readerSync";
import { safeLocalStorage } from "./resume";
import { reapplyRootState, setRootAttribute, setRootProperty } from "./rootAttributes";
import { getSpeedDefault } from "./speedDefaultRuntime";
import { loadTimeline, skipper, suggestNext } from "./suggested";
import { tabShared } from "./tabSlot";
import { reapplyTheme, startThemeSync } from "./themeRuntime";

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

/**
 * The one audio element, behind a seam (see narration/switchableAudio.ts). Created in script and
 * never placed in the DOM, so a router that swaps the page cannot take it down with the markup.
 * One per tab, not per copy of this module (tabSlot.ts): a deploy mid-session loads a second copy.
 */
export function getPlayerAudio(): SwitchableAudio {
  return tabShared("audio", () => {
    // The element a Play pressed before the player loaded has already unlocked, when there is one.
    const element = takeEarlyAudio() ?? new Audio();
    // CORS mode (an early element already asked for it, from its first load). The audio lives on the Blob host, another origin, and
    // Chrome takes the worker's saved copy of a no-cors cross-origin file for the first read only:
    // the next range read failed, so a downloaded briefing stopped after a second offline
    // (2026-10-22, the owner's phone). The Blob host answers with Access-Control-Allow-Origin: *.
    element.crossOrigin = "anonymous";
    return createSwitchableAudio(element);
  });
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

/** The running runtime's reader coupling, which `playBriefingOnArrival` tells where the listener is going. */
const readerSlot = (): { current: ReaderSync | null } =>
  tabShared("reader", () => ({ current: null as ReaderSync | null }));

/**
 * Plays a briefing the listener is being taken to (Up next): the same road as a cover press, so one
 * with no finished audio is narrated once its page has loaded.
 */
export function playBriefingOnArrival(digestId: string): void {
  readerSlot().current?.expectPage(digestId);
  getPlayerStore().playWhenPageLoads(digestId);
}

/** The listener's queue (playQueue.ts). Every change is told to the page as singularity:queue-changed. */
export function getPlayQueue(): PlayQueue {
  return tabShared("queue", () => createQueue());
}

function createQueue(): PlayQueue {
  return createPlayQueue({
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
}

/** The suggested items after what is playing: the list Up next shows and Autoplay draws from. */
export async function loadSuggested(): Promise<string[] | null> {
  const ordered = await loadTimeline();
  if (!ordered) return null;
  const currentId = getPlayerStore().getState().track?.digest.id ?? null;
  return suggestNext(ordered, currentId, skipper(safeLocalStorage(), getPlayQueue().getIds()));
}

/** Bumped when the listener picks an item, so an autoplay still loading its list gives way. */
const selections = (): { count: number } => tabShared("selections", () => ({ count: 0 }));

/**
 * Starts what comes next: the first queued item, or else, when `suggest` allows, the first
 * suggested one. Used when an item ends and by the lock screen's Next.
 */
export async function playUpNext(
  suggest: boolean,
  stillSuggesting: () => boolean = () => true,
): Promise<void> {
  const endedId = getPlayerStore().getState().track?.digest.id ?? null;
  // Looked at, not taken: the item leaves "to come" when it starts (playQueue.started), so one that
  // cannot start is still there to try again.
  const next = takeNext(getPlayQueue().getIds(), endedId).next;
  if (next) return playQueueItem(next);
  if (!suggest) return;
  const wasEnded = getPlayerStore().getState().status === "ended";
  const selectionsBefore = selections().count;
  const [first] = (await loadSuggested()) ?? [];
  // The listener may have queued something or moved on while the list loaded: the queue wins.
  if (selectionsBefore !== selections().count) return;
  if ((getPlayerStore().getState().track?.digest.id ?? null) !== endedId) return;
  // A replay of the same ended track keeps its id: leaving "ended" means the listener restarted it.
  if (wasEnded && getPlayerStore().getState().status !== "ended") return;
  const queuedMeanwhile = takeNext(getPlayQueue().getIds(), endedId).next;
  if (queuedMeanwhile) return playQueueItem(queuedMeanwhile);
  // Autoplay may have been switched off while the list loaded (the lock screen's Next ignores it).
  if (!stillSuggesting()) return;
  if (first) playQueueItem(first);
}

/**
 * Plays a queued item (or any briefing or episode) now, in place (D277): the player keeps its bar
 * and its one audio element and loads the item into them, so the listener is not taken to another
 * page and the bar never goes down between two items. The item's page is read once (queueMeta.ts),
 * usually already from the row that shows it. One with no finished audio is narrated from here.
 * Only a page that cannot be read (offline, gone) falls back to the road a cover press takes.
 */
export function playQueueItem(id: string): void {
  const mine = ++selections().count;
  const store = getPlayerStore();
  const state = store.getState();
  if (state.hasStarted && state.track?.digest.id === id) {
    // The row of what plays now: pressing it plays or resumes it, and starts nothing again.
    if (state.status !== "playing" && state.status !== "loading") store.play("user");
    return;
  }
  const cached = queueDigestFor(id);
  if (cached) {
    startInPlace(cached);
    return;
  }
  void loadQueueDigest(id).then((digest) => {
    // The listener picked another item while this page was being read: theirs is the one that starts.
    if (mine !== selections().count) return;
    if (digest) startInPlace(digest);
    else playQueueItemByPage(id);
  });
}

function startInPlace(read: PlayerDigestData): void {
  // A recording narrated earlier in this session comes back with its audio, as a page's Play gets it.
  const digest = narratedOrPage(read);
  if (!digest.audio) {
    void import("../../narration/narrationRuntime").then((narration) =>
      narration.narrateDigest(digest),
    );
    return;
  }
  const store = getPlayerStore();
  store.load(digest);
  store.play("user");
}

/** The road a page's cover takes: go to the item's page, which plays it on arrival. */
function playQueueItemByPage(id: string): void {
  const current = getPlayerStore().getState().track?.digest.id ?? null;
  playBriefingOnArrival(id);
  void playerSheet
    .collapse()
    .then(() => navigateTo(queueItemUrl(id), { direction: directionBetween(current, id) }));
}

/** The audio store, one per tab (tabSlot.ts): a second copy of this module gets the first one's. */
export function getPlayerStore(): PlayerStore {
  return tabShared("store", () =>
    createPlayerStore({
      createAudio: getPlayerAudio,
      storage: safeLocalStorage(),
      getPreferredRate: () => getSpeedDefault().getDefaultRate(),
      // A speed chosen here lasts this episode; the default is only a Settings choice or an accepted offer.
      onRateChange: (rate) =>
        getSpeedDefault().noteRate(getPlayerStore().getState().track?.digest.id ?? null, rate),
      onPageHide,
    }),
  );
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
  // A deploy while the tab is open loads a second copy of the bundle on the next page move, and its
  // layout script starts the runtime again. One runtime serves the tab: the first copy's listeners
  // already answer this page's controls, on the store and audio the bar shows. A second one would
  // answer them too, with a store and audio of its own.
  const claim = tabShared("runtime", () => ({ running: false }));
  if (claim.running) return () => undefined;
  claim.running = true;
  const playerStore = getPlayerStore();
  const preferences = getPreferences();
  // Counted for the install hint on Settings; nothing on this page waits on it, so it loads late.
  whenIdle(() => {
    import("./installHint")
      .then((hint) => hint.recordInstallVisit(safeLocalStorage()))
      .catch(() => undefined);
  });

  const detachMediaSession = attachMediaSession(playerStore, {
    onNextPastEnd: () => void playUpNext(true),
  });
  const reader = createReaderSync(playerStore, narrateFromTap);
  readerSlot().current = reader;
  const stopSound = startSound({ store: playerStore, preferences });

  const stopTheme = startThemeSync();

  syncRootState(playerStore);
  // The bar shows once something has started, so its island wakes then (islandWake.ts).
  const wakeOnStart = ({ hasStarted }: { hasStarted: boolean }): void => {
    if (hasStarted) wakeIslands();
  };
  wakeOnStart(playerStore.getState());
  const offWake = playerStore.subscribe(wakeOnStart);
  // "Playing." waits for the sound: a start that fails at once (offline) says only why.
  let starting: string | null = null;
  const offState = playerStore.subscribe(({ status }) => {
    syncRootState(playerStore);
    if (status === "loading") return;
    if (starting && status === "playing") announce(starting);
    starting = null;
  });
  // Before the queue's listener, so an end is counted for the item that ended, not the next one.
  const offListening = countListening(playerStore, track);
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
  // Queued items' first minutes are fetched at an idle moment, so a tap on any of the next three
  // starts at once (queuePrefetch.ts).
  let stopPrefetch: (() => void) | null = null;
  let tornDown = false;
  whenIdle(() => {
    if (tornDown) return;
    stopPrefetch = startQueuePrefetch(playQueue);
  });
  const offPageHide = onPageHide(() => getSpeedDefault().flush());
  const offQueueEnd = playerStore.onEvent((event) => {
    if (event.type !== "ended") return;
    getSpeedDefault().noteEnded(playerStore.getState().rate);
    // The listener chose what comes next, so it starts by itself. With nothing queued, Autoplay
    // (on unless turned off) starts the first suggested item.
    void playUpNext(preferences.get().autoplay, () => preferences.get().autoplay);
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
    removeEventListener("singularity:back", onBack);
    if (playerSheet.getSnapshot().open) void playerSheet.collapse();
  };
  // The navigation is already on its way; giving the entry back would turn it around.
  const dropEntry = (): void => {
    if (!entry) return;
    entry = false;
    removeEventListener("singularity:back", onBack);
  };
  const offEntry = playerSheet.subscribe(() => {
    const open = playerSheet.getSnapshot().open;
    if (open === wasOpen) return;
    wasOpen = open;
    if (open) {
      history.pushState({ ...history.state, playerOpen: true }, "");
      entry = true;
      addEventListener("singularity:back", onBack);
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
  // The first astro:page-load may have fired before this listener was in place.
  onPageLoad();
  // A Play pressed while the player was loading is pressed again, now that it has a listener.
  replayEarlyTap();

  return () => {
    tornDown = true;
    stopPrefetch?.();
    document.removeEventListener("astro:page-load", onPageLoad);
    document.removeEventListener("astro:before-preparation", onBeforeNavigation);
    document.removeEventListener("astro:after-swap", onAfterSwap);
    document.removeEventListener("keydown", onSpace);
    document.removeEventListener(QUEUE_ADD_EVENT, onQueueAdd);
    offListening();
    offQueueState();
    offQueueEnd();
    offPageHide();
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    offEvent();
    offState();
    offWake();
    offEntry();
    removeEventListener("singularity:back", onBack);
    stopTheme();
    stopSound();
    if (readerSlot().current === reader) readerSlot().current = null;
    claim.running = false;
    reader.destroy();
    detachMediaSession();
  };
}
