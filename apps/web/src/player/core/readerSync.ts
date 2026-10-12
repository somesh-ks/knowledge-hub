/**
 * Reader coupling: keeps the page and the player as one state.
 *
 * The page is server-rendered HTML, so this only writes attributes and one line of text per chip.
 * The contract with the markup:
 *   [data-item-id]       one per story, matching the audio timeline. Receives data-state: "played"
 *                        or "current"; absent means upcoming.
 *   [data-play-digest]   the briefing's play chip, and the floating Play button (.play-fab) that
 *                        stands for it below 64rem.
 *   [data-play-item]     a story's play chip. It names its story by index, by id, or by sitting
 *                        inside the story.
 *   On every chip        data-state (idle, current, played, or preparing while audio buffers),
 *                        data-playing, the visible text in [data-chip-label], and aria-label.
 *                        A control with no chip label keeps the words its page gave it.
 *                        Offline, with nothing loaded, the briefing's chip is data-state
 *                        "unavailable" and aria-disabled.
 *   [data-play-chapter]  a control that plays a section from its first story.
 *   .play-fab            while the bar holds the audio it plays, data-fab comes off the root: the
 *                        button steps aside and the page gives back the room it kept for it.
 *
 * A briefing without audio is left as the page rendered it: its chips keep their own unavailable or
 * hidden state until the page's data carries audio, except that offline they are unavailable too:
 * its narration is made on Play, from the network.
 *
 * Writes go through one animation-frame writer.
 */

import type { PlayerDigestData } from "../../types/contracts";
import { playPageChapter, togglePageDigest, togglePageItem } from "./pageActions";
import type { PlayerStore } from "./playerTypes";
import {
  barHolds,
  briefingChipView,
  type ChipView,
  createHeardTracker,
  type ItemVisualState,
  itemVisualState,
  type Remembered,
  resolveChapterFirstItemId,
  resolveItemId,
  storyChipView,
  storyLengthLabel,
} from "./readerMath";
import { playedKey, readResumePosition } from "./resume";
import { findItemIndexById } from "./timeline";

/** Auto-follow stays out of the way for this long after the reader scrolls. */
export const FOLLOW_PAUSE_MS = 4_000;
const SCROLL_KEYS = new Set(["PageDown", "PageUp", "Home", "End", " ", "ArrowDown", "ArrowUp"]);

export interface ReaderSync {
  /** Re-reads the page after a navigation swapped its DOM. */
  refresh(): void;
  /** An explicit play or seek means the reader wants the page to follow again. */
  resumeFollow(): void;
  /** A press is taking the listener to this briefing: once its page loads without audio, narrate it. */
  expectPage(id: string): void;
  destroy(): void;
}

interface Elements {
  items: Map<string, HTMLElement>;
  playDigest: HTMLElement[];
  playItem: HTMLElement[];
  /** The play buttons over covers, on a card or a hero. */
  coverPlay: HTMLElement[];
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function setDataset(element: HTMLElement, key: string, value: string): void {
  if (element.dataset[key] !== value) element.dataset[key] = value;
}

/**
 * Writes a chip's face. `blocked` is a chip that cannot do its job right now. The text and the name
 * go together: a control with no chip label (the floating Play button) keeps its own words.
 */
function writeChip(chip: HTMLElement, view: ChipView, blocked = false): void {
  setDataset(chip, "state", blocked ? "unavailable" : view.state);
  setDataset(chip, "playing", String(view.playing));
  const label = chip.querySelector("[data-chip-label]");
  if (label) {
    if (label.textContent !== view.label) label.textContent = view.label;
    if (chip.getAttribute("aria-label") !== view.name) chip.setAttribute("aria-label", view.name);
  }
  if (blocked) chip.setAttribute("aria-disabled", "true");
  else chip.removeAttribute("aria-disabled");
}

export function createReaderSync(
  store: PlayerStore,
  /** Called for a tap on Play when the page's briefing has no audio yet. */
  onNarrate?: (itemId?: string) => void,
): ReaderSync {
  let elements: Elements = emptyElements();
  let lastUserScroll = Number.NEGATIVE_INFINITY;
  let pendingWrite = 0;
  let wasScrubbing = false;
  /** The id of a briefing a cover sent the listener to, until its page has loaded. */
  let pendingNarrate: string | null = null;
  /** Which stories were heard: the ones passed by playing on, not by a jump (readerMath.ts). */
  const tracker = createHeardTracker();
  /** The story the playhead was in before the last move, for the page to follow from. */
  let followFrom = -1;

  function emptyElements(): Elements {
    return { items: new Map(), playDigest: [], playItem: [], coverPlay: [] };
  }

  function isLive(): boolean {
    const state = store.getState();
    const page = store.getPageDigest();
    return state.status !== "idle" && state.digestId !== null && state.digestId === page?.id;
  }

  /* ------------------------------------------------------------------ writing */

  /**
   * One play control at a time: while the bar holds the audio the floating Play button plays, the
   * bar is its control, so data-fab (the room kept for the button) comes off the root and the
   * button steps aside. Written on an incoming page before the swap too, so going back to the page
   * that is playing never shows the button for a frame.
   */
  function markFab(doc: Document): void {
    const fab = doc.querySelector<HTMLElement>(".play-fab");
    if (!fab) return;
    const held = barHolds(store.getState(), fab.dataset.playDigest);
    doc.documentElement.toggleAttribute("data-fab", !held);
  }

  function onBeforeSwap(event: { newDocument: Document }): void {
    markFab(event.newDocument);
  }

  /** Where this briefing was left and whether it was heard to the end, from the device's storage. */
  function rememberedFor(page: PlayerDigestData): Remembered {
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      return { seconds: 0, played: false };
    }
    const seconds = readResumePosition(storage, page.id, (page.audio?.duration_ms ?? 0) / 1000);
    let played = false;
    try {
      played = storage.getItem(playedKey(page.id)) !== null;
    } catch {
      played = false;
    }
    return { seconds, played };
  }

  /** What a chip of a page without audio showed before the device went offline. */
  const restful = new WeakMap<
    HTMLElement,
    { state: string | undefined; disabled: string | null }
  >();

  /** Narration is made on Play from the network: offline the chip cannot work, and says so. */
  function writeOffline(chips: readonly HTMLElement[]): void {
    const offline = !navigator.onLine;
    for (const chip of chips) {
      const rest = restful.get(chip);
      if (offline) {
        if (!rest) {
          restful.set(chip, {
            state: chip.dataset.state,
            disabled: chip.getAttribute("aria-disabled"),
          });
        }
        setDataset(chip, "state", "unavailable");
        chip.setAttribute("aria-disabled", "true");
      } else if (rest) {
        restful.delete(chip);
        if (rest.state === undefined) delete chip.dataset.state;
        else setDataset(chip, "state", rest.state);
        if (rest.disabled === null) chip.removeAttribute("aria-disabled");
        else chip.setAttribute("aria-disabled", rest.disabled);
      }
    }
  }

  function writeCoarse(): void {
    pendingWrite = 0;
    markFab(document);
    const state = store.getState();
    const page = store.getPageDigest();
    const live = isLive();
    const timeline = state.track?.timeline ?? null;
    const ended = state.status === "ended";
    const playing = state.status === "playing" || state.status === "loading";

    const visualOf = (id: string): ItemVisualState => {
      const index = live ? findItemIndexById(timeline, id) : -1;
      return index < 0 ? "" : itemVisualState(index, live, state.itemIndex, ended, tracker.heard);
    };

    for (const [id, element] of elements.items) {
      const value = visualOf(id);
      if (value) setDataset(element, "state", value);
      else delete element.dataset.state;
    }

    // A cover's button shows pause while its own item plays, on any page.
    for (const button of elements.coverPlay) {
      const on = state.digestId !== null && button.dataset.coverPlay === state.digestId && playing;
      if (button.parentElement) setDataset(button.parentElement, "playing", String(on));
      const verb = on ? "Pause" : "Play";
      const title = button.dataset.coverTitle;
      const name = title ? `${verb} ${title}` : verb;
      if (button.getAttribute("aria-label") !== name) button.setAttribute("aria-label", name);
    }

    // A briefing without audio keeps the state its page rendered, offline apart.
    if (!page?.audio) {
      writeOffline(elements.playDigest);
      return;
    }
    // Audio that arrived after the page was built (narrated on Play): the story chips the page
    // rendered hidden now have something to play, and the note about making audio is done.
    for (const chip of elements.playItem) if (chip.hidden) chip.hidden = false;
    const note = document.getElementById("play-hint");
    if (note && !note.hidden) note.hidden = true;

    for (const chip of elements.playDigest) {
      const noun = chip.dataset.noun === "episode" ? "episode" : "briefing";
      const briefing = briefingChipView(
        state,
        store.getTime(),
        page,
        noun,
        // What the Library's card says of it: only needed while the chip is not the player's own.
        state.digestId !== page.id || state.status === "idle" ? rememberedFor(page) : undefined,
      );
      // Audio is never cached, so offline a chip that would have to fetch it cannot work. One that
      // holds loaded audio still pauses and resumes.
      const blocked =
        !navigator.onLine && briefing.state !== "current" && briefing.state !== "preparing";
      writeChip(chip, briefing, blocked);
    }

    for (const chip of elements.playItem) {
      const id = resolveItemId(
        chip.dataset.playItem,
        page,
        chip.closest<HTMLElement>("[data-item-id]")?.dataset.itemId,
      );
      const item = page.items.find((entry) => entry.id === id);
      if (!item) continue;
      writeChip(
        chip,
        storyChipView(
          visualOf(item.id),
          playing,
          state.buffering,
          storyLengthLabel(item.start_ms, item.end_ms),
          item.headline,
        ),
      );
    }
  }

  function scheduleWrite(): void {
    if (pendingWrite) return;
    pendingWrite = requestAnimationFrame(writeCoarse);
  }

  /* ------------------------------------------------------------------ following */

  function markUserScroll(): void {
    lastUserScroll = performance.now();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (SCROLL_KEYS.has(event.key)) markUserScroll();
  }

  /**
   * Brings the story being read into view. When playing simply went on into it (`playedOn`), only a
   * reader who is reading along is followed: the story that has just ended, or this one when none
   * came before it, is on screen. Someone who has scrolled elsewhere is not pulled back to the voice.
   */
  function followCurrent(from = -1, playedOn = false): void {
    const state = store.getState();
    if (!isLive() || state.scrubbing) return;
    if (performance.now() - lastUserScroll < FOLLOW_PAUSE_MS) return;
    const items = state.track?.timeline?.items;
    const entry = items?.[state.itemIndex];
    const element = entry ? elements.items.get(entry.id) : null;
    if (!element) return;
    if (playedOn) {
      const before = items?.[from];
      const reference = (before ? elements.items.get(before.id) : null) ?? element;
      const shown = reference.getBoundingClientRect();
      if (shown.bottom <= 0 || shown.top >= window.innerHeight) return;
    }
    const rect = element.getBoundingClientRect();
    const comfortable = rect.top > window.innerHeight * 0.12 && rect.top < window.innerHeight * 0.5;
    if (comfortable) return;
    element.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
  }

  function resumeFollow(): void {
    lastUserScroll = Number.NEGATIVE_INFINITY;
  }

  /* ------------------------------------------------------------------ input */

  function onClick(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const page = store.getPageDigest();

    const coverButton = event.target.closest<HTMLElement>("[data-cover-play]");
    if (coverButton) {
      const id = coverButton.dataset.coverPlay;
      const href = coverButton.dataset.coverHref;
      resumeFollow();
      if (id) {
        void import("./coverPress").then((cover) =>
          cover.pressCover({
            store,
            onNarrate,
            expectPage: (expected) => {
              pendingNarrate = expected;
            },
            id,
            href,
          }),
        );
      }
      return;
    }

    const digestButton = event.target.closest<HTMLElement>("[data-play-digest]");
    if (digestButton) {
      if (digestButton.getAttribute("aria-disabled") === "true") return;
      resumeFollow();
      if (page && !page.audio) {
        onNarrate?.();
        return;
      }
      togglePageDigest(store);
      return;
    }

    const itemButton = event.target.closest<HTMLElement>("[data-play-item]");
    if (itemButton) {
      const id = resolveItemId(
        itemButton.dataset.playItem,
        page,
        itemButton.closest<HTMLElement>("[data-item-id]")?.dataset.itemId,
      );
      if (!id) return;
      resumeFollow();
      togglePageItem(store, id);
      return;
    }

    const chapterButton = event.target.closest<HTMLElement>(
      "[data-play-chapter], [data-chapter-play]",
    );
    if (chapterButton) {
      const value =
        chapterButton.dataset.playChapter ??
        chapterButton.dataset.chapterPlay ??
        chapterButton.dataset.section;
      const id = resolveChapterFirstItemId(value, page);
      if (!id) return;
      resumeFollow();
      playPageChapter(store, id);
    }
  }

  /* ------------------------------------------------------------------ lifecycle */

  function collect(): Elements {
    const found = emptyElements();
    for (const element of document.querySelectorAll<HTMLElement>("[data-item-id]")) {
      const id = element.dataset.itemId;
      if (id) found.items.set(id, element);
    }
    found.playDigest = [...document.querySelectorAll<HTMLElement>("[data-play-digest]")];
    found.playItem = [...document.querySelectorAll<HTMLElement>("[data-play-item]")];
    found.coverPlay = [...document.querySelectorAll<HTMLElement>("[data-cover-play]")];
    return found;
  }

  function refresh(): void {
    elements = collect();
    writeCoarse();
    // A cover pressed in a list brought the listener here: a page with no audio yet is narrated now.
    const page = store.getPageDigest();
    if (pendingNarrate !== null && page?.id === pendingNarrate) {
      pendingNarrate = null;
      if (!page.audio) onNarrate?.();
    }
  }

  window.addEventListener("wheel", markUserScroll, { passive: true });
  window.addEventListener("touchmove", markUserScroll, { passive: true });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("online", scheduleWrite);
  window.addEventListener("offline", scheduleWrite);
  document.addEventListener("click", onClick);
  document.addEventListener("astro:before-swap", onBeforeSwap);

  const offEvent = store.onEvent((event) => {
    if (event.type === "loaded") {
      followFrom = store.getState().itemIndex;
      tracker.reset(followFrom);
    } else if (event.type === "ended") {
      tracker.ended();
    } else if (event.type === "itemChanged") {
      const from = followFrom;
      followFrom = event.index;
      tracker.moved(event.index, event.cause);
      if (store.getState().status !== "idle") followCurrent(from, event.cause === "auto");
    }
  });

  // Whole seconds and seeks: the minutes left on a paused briefing change with the playhead.
  const offSecond = store.onSecond(scheduleWrite);
  const offState = store.subscribe((state) => {
    scheduleWrite();
    const scrubEnded = wasScrubbing && !state.scrubbing;
    wasScrubbing = state.scrubbing;
    // A move of the playhead follows through its own event (above); a scrub that has ended follows here.
    if (state.status !== "idle" && scrubEnded) followCurrent();
  });

  refresh();

  return {
    refresh,
    resumeFollow,
    expectPage(id) {
      pendingNarrate = id;
    },
    destroy() {
      offSecond();
      offEvent();
      offState();
      if (pendingWrite) cancelAnimationFrame(pendingWrite);
      window.removeEventListener("wheel", markUserScroll);
      window.removeEventListener("touchmove", markUserScroll);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("online", scheduleWrite);
      window.removeEventListener("offline", scheduleWrite);
      document.removeEventListener("click", onClick);
      document.removeEventListener("astro:before-swap", onBeforeSwap);
    },
  };
}
