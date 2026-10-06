/**
 * Reader coupling: keeps the page, the rail and the player as one state.
 *
 * The page is server-rendered HTML, so this only toggles attributes and writes one transform per
 * frame. The contract with the markup is design-spec.md section 10:
 *   [data-item-id]         one per digest item, matching the audio timeline
 *   [data-chapter]         one per section, by slug
 *   data-state             "played" or "current"; absent means upcoming
 *   .briefing[data-live]   present while a playhead exists and the digest has not ended
 *   .rail-fill             a leaf element; receives --player-progress (0 to 1 of the rail height)
 *   [data-play-digest]     the hero button; [data-play-item] and [data-chapter-play] likewise
 *
 * Writes go through one animation-frame writer. The playhead itself paints straight from the
 * store's frame callback, which already runs inside an animation frame.
 */

import { playPageChapter, playPageItemAt, togglePageDigest, togglePageItem } from "./pageActions";
import type { PlayerStore } from "./playerTypes";
import {
  ctaView,
  itemVisualState,
  nearestNodeIndex,
  railProgress,
  resolveChapterFirstItemId,
  resolveItemId,
} from "./readerMath";

/** Auto-follow stays out of the way for this long after the reader scrolls. */
export const FOLLOW_PAUSE_MS = 4_000;
const SEEK_GLIDE_MS = 400;
const TAP_SLOP_PX = 10;
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
  chapters: HTMLElement[];
  asideLinks: HTMLElement[];
  briefing: HTMLElement | null;
  railFill: HTMLElement | null;
  playDigest: HTMLElement[];
  playItem: HTMLElement[];
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function setDataset(element: HTMLElement, key: string, value: string): void {
  if (element.dataset[key] !== value) element.dataset[key] = value;
}

/**
 * Where an item's rail node sits, measured from the top of the briefing. The page draws a `.node`
 * on the rail; without one the fill still has to land somewhere believable, so it aims at the
 * middle of the heading's first line (a tall item's own center would be far below its title).
 */
function anchorCenter(item: HTMLElement, briefingTop: number): number {
  const node = item.querySelector<HTMLElement>(".node");
  if (node) {
    const rect = node.getBoundingClientRect();
    return rect.top - briefingTop + rect.height / 2;
  }
  const heading = item.querySelector<HTMLElement>("h2, h3, h4");
  if (heading) {
    const rect = heading.getBoundingClientRect();
    const leading = Number.parseFloat(getComputedStyle(heading).lineHeight);
    // `normal` parses as NaN; half the box is the honest guess for it.
    const firstLine = Number.isFinite(leading) ? leading : rect.height;
    return rect.top - briefingTop + Math.min(firstLine, rect.height) / 2;
  }
  return item.getBoundingClientRect().top - briefingTop;
}

function setText(element: Element, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

export function createReaderSync(store: PlayerStore): ReaderSync {
  let elements: Elements = emptyElements();
  /** Node centers by timeline index, measured from the top of the briefing. */
  let nodeY: (number | undefined)[] = [];
  let totalHeight = 1;
  let lastUserScroll = Number.NEGATIVE_INFINITY;
  let pendingWrite = 0;
  let glideTimer: ReturnType<typeof setTimeout> | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let lastItemIndex = -1;
  let wasScrubbing = false;
  let lastTrack: unknown = null;

  function emptyElements(): Elements {
    return {
      items: new Map(),
      chapters: [],
      asideLinks: [],
      briefing: null,
      railFill: null,
      playDigest: [],
      playItem: [],
    };
  }

  function isLive(): boolean {
    const state = store.getState();
    const page = store.getPageDigest();
    return state.status !== "idle" && state.digestId !== null && state.digestId === page?.id;
  }

  /* ------------------------------------------------------------------ measuring */

  function measure(): void {
    nodeY = [];
    const briefing = elements.briefing;
    if (!briefing) return;
    const top = briefing.getBoundingClientRect().top;
    totalHeight = briefing.getBoundingClientRect().height || 1;
    const timeline = store.getState().track?.timeline;
    if (!timeline) return;
    for (const entry of timeline.items) {
      const item = elements.items.get(entry.id);
      if (!item) continue;
      nodeY[entry.index] = anchorCenter(item, top);
    }
    paintRail(store.getTime());
  }

  /* ------------------------------------------------------------------ writing */

  function paintRail(time: number): void {
    const fill = elements.railFill;
    if (!fill) return;
    const state = store.getState();
    const progress = isLive()
      ? railProgress(
          nodeY,
          totalHeight,
          state.track?.timeline ?? null,
          state.itemIndex,
          time,
          state.status === "ended",
        )
      : 0;
    fill.style.setProperty("--player-progress", progress.toFixed(5));
  }

  function writeCoarse(): void {
    pendingWrite = 0;
    const state = store.getState();
    const page = store.getPageDigest();
    const live = isLive();
    const timeline = state.track?.timeline ?? null;
    const ended = state.status === "ended";
    const playing = state.status === "playing" || state.status === "loading";

    elements.briefing?.toggleAttribute("data-live", live && !ended);

    for (const [id, element] of elements.items) {
      const index = timeline?.items.findIndex((entry) => entry.id === id) ?? -1;
      const value = index < 0 ? "" : itemVisualState(index, live, state.itemIndex, ended);
      if (value) setDataset(element, "state", value);
      else delete element.dataset.state;
    }

    const currentSection = live && !ended ? timeline?.sections[state.sectionIndex]?.slug : null;
    for (const chapter of elements.chapters) {
      const slug = chapter.dataset.chapter;
      const index = timeline?.sections.findIndex((section) => section.slug === slug) ?? -1;
      let value: string;
      if (!live || index < 0) value = "";
      else if (ended) value = "played";
      else
        value =
          index < state.sectionIndex ? "played" : index === state.sectionIndex ? "current" : "";
      if (value) setDataset(chapter, "state", value);
      else delete chapter.dataset.state;
    }
    for (const link of elements.asideLinks) {
      const slug = link.dataset.section ?? link.dataset.chapterLink;
      if (currentSection && slug === currentSection) setDataset(link, "state", "current");
      else delete link.dataset.state;
    }

    // A digest without audio keeps the page's own "audio is still being prepared" state.
    const cta = page?.audio ? ctaView(state, store.getTime(), page) : null;
    if (cta) {
      for (const button of elements.playDigest) {
        setDataset(button, "playing", String(cta.playing));
        if (cta.loading) setDataset(button, "loading", "true");
        else delete button.dataset.loading;
        const label = button.querySelector("[data-play-label]");
        if (label) setText(label, cta.label);
        const clock = button.querySelector("[data-play-time]");
        if (clock) setText(clock, cta.clock);
      }
    }

    for (const button of elements.playItem) {
      const id = resolveItemId(
        button.dataset.playItem,
        page,
        button.closest<HTMLElement>("[data-item-id]")?.dataset.itemId,
      );
      if (!id) continue;
      const index = timeline?.items.findIndex((entry) => entry.id === id) ?? -1;
      const current = live && !ended && index >= 0 && index === state.itemIndex;
      const itemPlaying = current && playing;
      setDataset(button, "current", String(current));
      setDataset(button, "playing", String(itemPlaying));
      const headline = page?.items.find((item) => item.id === id)?.headline ?? "";
      const label = `${itemPlaying ? "Pause" : "Listen from here"}: ${headline}`;
      if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label);
    }
    paintRail(store.getTime());
  }

  function scheduleWrite(): void {
    if (pendingWrite) return;
    pendingWrite = requestAnimationFrame(writeCoarse);
  }

  function paintClocks(): void {
    const state = store.getState();
    const page = store.getPageDigest();
    if (!page?.audio) return;
    const cta = ctaView(state, store.getTime(), page);
    for (const button of elements.playDigest) {
      const clock = button.querySelector("[data-play-time]");
      if (clock) setText(clock, cta.clock);
    }
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

  function glide(): void {
    const fill = elements.railFill;
    if (!fill) return;
    fill.setAttribute("data-seeking", "");
    if (glideTimer !== null) clearTimeout(glideTimer);
    glideTimer = setTimeout(() => {
      fill.removeAttribute("data-seeking");
      glideTimer = null;
    }, SEEK_GLIDE_MS);
  }

  /* ------------------------------------------------------------------ input */

  let tap: { x: number; y: number; moved: boolean; id: number } | null = null;

  function onPointerDown(event: PointerEvent): void {
    if (!(event.target instanceof Element) || !event.target.closest(".rail-hit, [data-rail-hit]")) {
      return;
    }
    tap = { x: event.clientX, y: event.clientY, moved: false, id: event.pointerId };
  }

  function onPointerMove(event: PointerEvent): void {
    if (!tap || event.pointerId !== tap.id) return;
    if (
      Math.abs(event.clientY - tap.y) > TAP_SLOP_PX ||
      Math.abs(event.clientX - tap.x) > TAP_SLOP_PX
    ) {
      tap.moved = true;
    }
  }

  function onPointerCancel(): void {
    tap = null;
  }

  function onPointerUp(event: PointerEvent): void {
    const gesture = tap;
    tap = null;
    if (!gesture || gesture.moved || event.pointerId !== gesture.id) return;
    const briefing = elements.briefing;
    if (!briefing) return;
    const y = event.clientY - briefing.getBoundingClientRect().top;
    const index = nearestNodeIndex(nodeY, y);
    if (index < 0) return;
    glide();
    resumeFollow();
    playPageItemAt(store, index);
  }

  function resumeFollow(): void {
    lastUserScroll = Number.NEGATIVE_INFINITY;
  }

  function onClick(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const page = store.getPageDigest();

    const digestButton = event.target.closest<HTMLElement>("[data-play-digest]");
    if (digestButton) {
      if (digestButton.getAttribute("aria-disabled") === "true") return;
      resumeFollow();
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
    found.chapters = [...document.querySelectorAll<HTMLElement>("[data-chapter]")];
    found.asideLinks = [
      ...document.querySelectorAll<HTMLElement>(".aside-link, [data-chapter-link]"),
    ];
    found.briefing = document.querySelector<HTMLElement>(".briefing");
    found.railFill = document.querySelector<HTMLElement>(".rail-fill");
    found.playDigest = [...document.querySelectorAll<HTMLElement>("[data-play-digest]")];
    found.playItem = [...document.querySelectorAll<HTMLElement>("[data-play-item]")];
    return found;
  }

  function refresh(): void {
    resizeObserver?.disconnect();
    elements = collect();
    resizeObserver = new ResizeObserver(measure);
    if (elements.briefing) resizeObserver.observe(elements.briefing);
    void document.fonts?.ready.then(measure);
    measure();
    writeCoarse();
  }

  window.addEventListener("wheel", markUserScroll, { passive: true });
  window.addEventListener("touchmove", markUserScroll, { passive: true });
  window.addEventListener("keydown", onKeyDown);
  document.addEventListener("click", onClick);
  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", onPointerCancel);

  const offFrame = store.onFrame((time) => paintRail(time));
  const offSecond = store.onSecond(paintClocks);
  const offState = store.subscribe((state) => {
    scheduleWrite();
    const itemChanged = state.itemIndex !== lastItemIndex;
    const scrubEnded = wasScrubbing && !state.scrubbing;
    lastItemIndex = state.itemIndex;
    wasScrubbing = state.scrubbing;
    if (state.status !== "idle" && (itemChanged || scrubEnded)) followCurrent();
    // A new track means new item ids to find and new node positions to measure.
    if (state.track !== lastTrack) {
      lastTrack = state.track;
      queueMicrotask(measure);
    }
  });
  const offEvent = store.onEvent((event) => {
    if (event.type === "itemChanged" && (event.cause === "select" || event.cause === "seek"))
      glide();
  });

  refresh();

  return {
    refresh,
    resumeFollow,
    destroy() {
      offFrame();
      offSecond();
      offState();
      offEvent();
      resizeObserver?.disconnect();
      if (glideTimer !== null) clearTimeout(glideTimer);
      if (pendingWrite) cancelAnimationFrame(pendingWrite);
      window.removeEventListener("wheel", markUserScroll);
      window.removeEventListener("touchmove", markUserScroll);
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("click", onClick);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerCancel);
    },
  };
}
