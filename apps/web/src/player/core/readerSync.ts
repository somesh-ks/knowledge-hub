/**
 * Reader coupling: keeps the page and the player as one state.
 *
 * The page is server-rendered HTML, so this only writes attributes and one line of text per chip.
 * The contract with the markup:
 *   [data-item-id]       one per story, matching the audio timeline. Receives data-state: "played"
 *                        or "current"; absent means upcoming.
 *   [data-play-digest]   the briefing's play chip.
 *   [data-play-item]     a story's play chip. It names its story by index, by id, or by sitting
 *                        inside the story.
 *   On every chip        data-state (idle, current, played, or preparing while audio buffers),
 *                        data-playing, the visible text in [data-chip-label], and aria-label.
 *                        Offline, with nothing loaded, the briefing's chip is data-state
 *                        "unavailable" and aria-disabled.
 *   [data-play-chapter]  a control that plays a section from its first story.
 *
 * A briefing without audio is left exactly as the page rendered it: its chips keep their own
 * unavailable or hidden state until the page's data carries audio.
 *
 * Writes go through one animation-frame writer.
 */

import { playPageChapter, togglePageDigest, togglePageItem } from "./pageActions";
import type { PlayerStore } from "./playerTypes";
import {
  briefingChipView,
  type ChipView,
  type ItemVisualState,
  itemVisualState,
  resolveChapterFirstItemId,
  resolveItemId,
  storyChipView,
  storyLengthLabel,
} from "./readerMath";
import { findItemIndexById } from "./timeline";

/** Auto-follow stays out of the way for this long after the reader scrolls. */
export const FOLLOW_PAUSE_MS = 4_000;
const SCROLL_KEYS = new Set(["PageDown", "PageUp", "Home", "End", " ", "ArrowDown", "ArrowUp"]);

export interface ReaderSync {
  /** Re-reads the page after a navigation swapped its DOM. */
  refresh(): void;
  /** An explicit play or seek means the reader wants the page to follow again. */
  resumeFollow(): void;
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

/** Writes a chip's face. `blocked` is a chip that cannot do its job right now. */
function writeChip(chip: HTMLElement, view: ChipView, blocked = false): void {
  setDataset(chip, "state", blocked ? "unavailable" : view.state);
  setDataset(chip, "playing", String(view.playing));
  const label = chip.querySelector("[data-chip-label]");
  if (label && label.textContent !== view.label) label.textContent = view.label;
  if (chip.getAttribute("aria-label") !== view.name) chip.setAttribute("aria-label", view.name);
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
  let lastItemIndex = -1;
  let wasScrubbing = false;
  /** The id of a briefing a cover sent the listener to, until its page has loaded. */
  let pendingNarrate: string | null = null;

  function emptyElements(): Elements {
    return { items: new Map(), playDigest: [], playItem: [], coverPlay: [] };
  }

  function isLive(): boolean {
    const state = store.getState();
    const page = store.getPageDigest();
    return state.status !== "idle" && state.digestId !== null && state.digestId === page?.id;
  }

  /* ------------------------------------------------------------------ writing */

  function writeCoarse(): void {
    pendingWrite = 0;
    const state = store.getState();
    const page = store.getPageDigest();
    const live = isLive();
    const timeline = state.track?.timeline ?? null;
    const ended = state.status === "ended";
    const playing = state.status === "playing" || state.status === "loading";

    const visualOf = (id: string): ItemVisualState => {
      const index = live ? findItemIndexById(timeline, id) : -1;
      return index < 0 ? "" : itemVisualState(index, live, state.itemIndex, ended);
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

    // A briefing without audio keeps the state its page rendered.
    if (!page?.audio) return;
    // Audio that arrived after the page was built (narrated on Play): the story chips the page
    // rendered hidden now have something to play, and the note about making audio is done.
    for (const chip of elements.playItem) if (chip.hidden) chip.hidden = false;
    const note = document.getElementById("play-hint");
    if (note && !note.hidden) note.hidden = true;

    for (const chip of elements.playDigest) {
      const noun = chip.dataset.noun === "episode" ? "episode" : "briefing";
      const briefing = briefingChipView(state, store.getTime(), page, noun);
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

  function followCurrent(): void {
    const state = store.getState();
    if (!isLive() || state.scrubbing) return;
    if (performance.now() - lastUserScroll < FOLLOW_PAUSE_MS) return;
    const entry = state.track?.timeline?.items[state.itemIndex];
    const element = entry ? elements.items.get(entry.id) : null;
    if (!element) return;
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

  // Whole seconds and seeks: the minutes left on a paused briefing change with the playhead.
  const offSecond = store.onSecond(scheduleWrite);
  const offState = store.subscribe((state) => {
    scheduleWrite();
    const itemChanged = state.itemIndex !== lastItemIndex;
    const scrubEnded = wasScrubbing && !state.scrubbing;
    lastItemIndex = state.itemIndex;
    wasScrubbing = state.scrubbing;
    if (state.status !== "idle" && (itemChanged || scrubEnded)) followCurrent();
  });

  refresh();

  return {
    refresh,
    resumeFollow,
    destroy() {
      offSecond();
      offState();
      if (pendingWrite) cancelAnimationFrame(pendingWrite);
      window.removeEventListener("wheel", markUserScroll);
      window.removeEventListener("touchmove", markUserScroll);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("online", scheduleWrite);
      window.removeEventListener("offline", scheduleWrite);
      document.removeEventListener("click", onClick);
    },
  };
}
