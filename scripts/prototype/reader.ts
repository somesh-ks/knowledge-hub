/**
 * Reader sync: keeps the page, the rail and the player as one state.
 *
 * The page is server-rendered HTML in production, so this controller only toggles attributes and
 * writes one transform per frame. Contract with the markup:
 *   .item[data-item-id][data-index]      one per digest item, id matches the audio timeline
 *   .chapter-block[data-chapter]         one per section
 *   data-state="played" | "current"      on .item and .chapter; absent means upcoming
 *   .briefing[data-live]                 present while a playhead exists, dims non-current summaries
 *   .rail-fill                           leaf element; receives --player-progress (0 to 1 of rail height)
 */
import { clamp, lerp, prefersReducedMotion } from "./motion.js";
import type { Player, PlayerState } from "./playerStore.js";
import { ITEMS, type Timeline } from "./sampleContent.js";

/** Auto-follow pauses for a few seconds after the reader scrolls, so it never fights the finger. */
let lastUserScroll = 0;
const markScroll = (): void => {
  lastUserScroll = Date.now();
};
/** An explicit play or seek means the reader wants the page to follow again. */
export const resumeFollow = (): void => {
  lastUserScroll = 0;
};
for (const type of ["wheel", "touchmove"] as const) {
  window.addEventListener(type, markScroll, { passive: true });
}
window.addEventListener("keydown", (event) => {
  if (["PageDown", "PageUp", "Home", "End", " ", "ArrowDown", "ArrowUp"].includes(event.key))
    markScroll();
});

export interface ReaderOptions {
  briefing: HTMLElement;
  player: Player;
  timeline: Timeline;
  /** Tap on the rail strip or a node resolves to an item. */
  onSeekItem: (index: number) => void;
}

export function createReader(options: ReaderOptions) {
  const { briefing, player, timeline } = options;
  const fill = briefing.querySelector<HTMLElement>(".rail-fill");
  const railHit = briefing.querySelector<HTMLElement>(".rail-hit");
  const items = [...briefing.querySelectorAll<HTMLElement>(".item")];
  const chapters = [...briefing.querySelectorAll<HTMLElement>(".chapter")];
  const aside = [...document.querySelectorAll<HTMLElement>(".aside-link")];
  const nodeY: number[] = [];
  let total = 1;
  let lastItem = -1;

  function measure(): void {
    const top = briefing.getBoundingClientRect().top;
    total = briefing.getBoundingClientRect().height || 1;
    nodeY.length = 0;
    for (const item of items) {
      const node = item.querySelector<HTMLElement>(".node");
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      nodeY.push(rect.top - top + rect.height / 2);
    }
    paint(player.getState().time);
  }

  /** Piecewise linear between item nodes, by time. This is why the rail fills continuously. */
  function paint(time: number): void {
    if (!fill) return;
    const state = player.getState();
    if (!state.hasStarted) {
      fill.style.setProperty("--player-progress", "0");
      return;
    }
    const index = player.itemAt(time);
    const entry = timeline.items[index];
    if (!entry || nodeY.length === 0) return;
    const start = nodeY[index] ?? 0;
    const end = nodeY[index + 1] ?? total;
    const fraction = clamp((time - entry.startSec) / (entry.endSec - entry.startSec), 0, 1);
    const y = state.status === "ended" ? total : lerp(start, end, fraction);
    fill.style.setProperty("--player-progress", clamp(y / total, 0, 1).toFixed(5));
  }

  function syncState(state: PlayerState): void {
    const live = state.hasStarted && state.status !== "ended";
    briefing.toggleAttribute("data-live", live);
    const finished = state.status === "ended";
    items.forEach((item, index) => {
      const value = finished
        ? "played"
        : !state.hasStarted
          ? ""
          : index < state.itemIndex
            ? "played"
            : index === state.itemIndex
              ? "current"
              : "";
      if (value) item.dataset.state = value;
      else delete item.dataset.state;

      const button = item.querySelector<HTMLButtonElement>(".item-play");
      if (button) {
        const current = state.hasStarted && !finished && index === state.itemIndex;
        const playing = current && state.status === "playing";
        button.dataset.current = String(current);
        button.dataset.playing = String(playing);
        const headline = ITEMS[index]?.headline ?? "";
        button.setAttribute("aria-label", `${playing ? "Pause" : "Listen from here"}: ${headline}`);
      }
    });
    chapters.forEach((chapter, index) => {
      const value = finished
        ? "played"
        : !state.hasStarted
          ? ""
          : index < state.sectionIndex
            ? "played"
            : index === state.sectionIndex
              ? "current"
              : "";
      if (value) chapter.dataset.state = value;
      else delete chapter.dataset.state;
    });
    aside.forEach((link, index) => {
      if (state.hasStarted && !finished && index === state.sectionIndex)
        link.dataset.state = "current";
      else delete link.dataset.state;
    });
    paint(state.time);
  }

  /** Brings the current item into view unless the reader is scrolling or it is already comfortable. */
  function followCurrent(index: number): void {
    const item = items[index];
    if (!item || Date.now() - lastUserScroll < 4000) return;
    const rect = item.getBoundingClientRect();
    const viewport = window.innerHeight;
    const comfortable = rect.top > viewport * 0.12 && rect.top < viewport * 0.5;
    if (comfortable) return;
    item.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }

  const observer = new ResizeObserver(measure);
  observer.observe(briefing);
  void document.fonts?.ready.then(measure);

  const offFrame = player.onFrame((time) => paint(time));
  const offState = player.subscribe((state) => {
    syncState(state);
    if (state.itemIndex !== lastItem && state.hasStarted) {
      lastItem = state.itemIndex;
      if (!state.scrubbing) followCurrent(state.itemIndex);
    }
  });

  /* Rail tap: the strip is one flush target, so a tap between nodes resolves to the nearest. */
  if (railHit) {
    let startY = 0;
    let startX = 0;
    let moved = false;
    railHit.addEventListener("pointerdown", (event) => {
      startY = event.clientY;
      startX = event.clientX;
      moved = false;
    });
    railHit.addEventListener("pointermove", (event) => {
      if (Math.abs(event.clientY - startY) > 10 || Math.abs(event.clientX - startX) > 10)
        moved = true;
    });
    railHit.addEventListener("pointerup", (event) => {
      if (moved) return;
      const top = briefing.getBoundingClientRect().top;
      const y = event.clientY - top;
      let nearest = 0;
      let best = Number.POSITIVE_INFINITY;
      nodeY.forEach((value, index) => {
        const distance = Math.abs(value - y);
        if (distance < best) {
          best = distance;
          nearest = index;
        }
      });
      fill?.setAttribute("data-seeking", "");
      window.setTimeout(() => fill?.removeAttribute("data-seeking"), 400);
      resumeFollow();
      options.onSeekItem(nearest);
    });
  }

  measure();
  syncState(player.getState());
  return {
    measure,
    paint,
    destroy() {
      observer.disconnect();
      offFrame();
      offState();
    },
  };
}
