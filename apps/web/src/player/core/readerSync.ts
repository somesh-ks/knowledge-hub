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
 *                        data-playing, the visible text in [data-chip-label] (the floating
 *                        button's in [data-fab-label], with its verb), and aria-label.
 *                        Offline, with nothing loaded, the briefing's chip is data-state
 *                        "unavailable" and aria-disabled.
 *                        A chip of a page without audio carries data-minutes, its page's estimate.
 *   [data-play-chapter]  a control that plays a section from its first story.
 *   .play-fab            while the bar holds the audio it plays, data-fab comes off the root: the
 *                        button steps aside and the page gives back the room it kept for it.
 *
 * A briefing without audio says what the device remembers of it, as its card does; its story chips
 * stay hidden until the page's data carries audio, and offline its chip is unavailable: its
 * narration is made on Play, from the network.
 *
 * What the device remembers (resume.ts) also marks the stories heard, from any session, and the
 * cards on every page (cardProgress.ts).
 *
 * Writes go through one animation-frame writer.
 */

import type { PlayerDigestData } from "../../types/contracts";
import { showCardProgress } from "./cardProgress";
import { playPageChapter, togglePageDigest, togglePageItem } from "./pageActions";
import type { PlayerStore } from "./playerTypes";
import {
  barHolds,
  briefingChipView,
  type ChipView,
  createHeardTracker,
  fabLabel,
  type ItemVisualState,
  itemVisualState,
  rememberedChip,
  resolveChapterFirstItemId,
  resolveItemId,
  storyChipView,
  storyLengthLabel,
} from "./readerMath";
import { type Remembered, readRemembered, safeLocalStorage, saveHeard } from "./resume";
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
 * go together: the floating Play button says the chip's words after its verb.
 */
function writeChip(chip: HTMLElement, view: ChipView, blocked = false): void {
  setDataset(chip, "state", blocked ? "unavailable" : view.state);
  setDataset(chip, "playing", String(view.playing));
  const label = chip.querySelector<HTMLElement>("[data-chip-label], [data-fab-label]");
  if (label) {
    const text = label.dataset.fabLabel === undefined ? view.label : fabLabel(view);
    if (label.textContent !== text) label.textContent = text;
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
    return readRemembered(safeLocalStorage(), page.id, (page.audio?.duration_ms ?? 0) / 1000);
  }

  /** The stories heard of the recording the player holds go beside its position (resume.ts). */
  function keepHeard(): void {
    const track = store.getState().track;
    const items = track?.timeline?.items ?? [];
    if (track) {
      saveHeard(
        safeLocalStorage(),
        track.digest.id,
        [...tracker.heard].flatMap((index) => items[index]?.id ?? []),
      );
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

    // Not in the ear: the stories the device remembers hearing, from this session or another.
    const heard = live || !page ? [] : rememberedFor(page).heard;
    const visualOf = (id: string): ItemVisualState => {
      if (!live) return heard.includes(id) ? "played" : "";
      const index = findItemIndexById(timeline, id);
      return index < 0
        ? ""
        : itemVisualState(
            index,
            live,
            state.itemIndex,
            ended,
            tracker.heard,
            state.status === "error",
          );
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

    if (!page) return;
    const { audio } = page;
    // Audio that arrived after the page was built (narrated on Play): the story chips the page
    // rendered hidden now have something to play, and the note about making audio is done.
    if (audio) {
      for (const chip of elements.playItem) if (chip.hidden) chip.hidden = false;
      const note = document.getElementById("play-hint");
      if (note && !note.hidden) note.hidden = true;
    }

    for (const chip of elements.playDigest) {
      const noun = chip.dataset.noun === "episode" ? "episode" : "briefing";
      // Without audio, while narration makes the first file, the chip is narration's.
      if (!audio && chip.hasAttribute("aria-busy")) continue;
      const view = audio
        ? briefingChipView(
            state,
            store.getTime(),
            page,
            noun,
            // What the Library's card says of it: only needed while the chip is not the player's own.
            state.digestId !== page.id || state.status === "idle" ? rememberedFor(page) : undefined,
          )
        : // What the device remembers, against the page's estimate (the minutes its card says).
          rememberedChip(rememberedFor(page), Number(chip.dataset.minutes) * 60, noun);
      // Audio is never cached and narration is made from the network, so offline a chip that would
      // have to fetch it cannot work. One that holds loaded audio still pauses and resumes.
      writeChip(
        chip,
        view,
        !navigator.onLine && view.state !== "current" && view.state !== "preparing",
      );
    }
    if (!audio) return;

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

  function onMemory(): void {
    scheduleWrite();
    showCardProgress();
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
    showCardProgress();
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
  // Back from the cache, or the player saved where it is: the chips and the cards follow.
  window.addEventListener("pageshow", onMemory);
  window.addEventListener("dispatch:resume", onMemory);
  document.addEventListener("click", onClick);
  document.addEventListener("astro:before-swap", onBeforeSwap);

  const offEvent = store.onEvent((event) => {
    const state = store.getState();
    if (event.type === "loaded") {
      followFrom = state.itemIndex;
      // Heard before, in this session or another: the stories still read Played. One heard to the
      // end starts afresh on its next move, as it would have in the session it ended in.
      const track = state.track;
      const remembered = track && rememberedFor(track.digest);
      tracker.reset(
        followFrom,
        remembered?.heard
          .map((id) => findItemIndexById(track?.timeline ?? null, id))
          .filter((index) => index >= 0),
        remembered?.played && remembered.seconds <= 0,
      );
    } else if (event.type === "ended") {
      tracker.ended();
    } else if (event.type === "itemChanged") {
      const from = followFrom;
      followFrom = event.index;
      tracker.moved(event.index, event.cause);
      if (state.status !== "idle") followCurrent(from, event.cause === "auto");
    } else return;
    keepHeard();
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
      window.removeEventListener("pageshow", onMemory);
      window.removeEventListener("dispatch:resume", onMemory);
      document.removeEventListener("click", onClick);
      document.removeEventListener("astro:before-swap", onBeforeSwap);
    },
  };
}
