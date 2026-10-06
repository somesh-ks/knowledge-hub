/**
 * The scrubber: a pointer-capture slider with a tick at every item start.
 *
 * Behavior
 * - Pointer down anywhere on the 44px hit strip begins a scrub; the thumb jumps under the finger
 *   and then follows it 1:1, even outside the strip (pointer capture).
 * - Narration pauses while the thumb is down and resumes at release, so a drag never produces
 *   audio bursts or a storm of range requests. Seeking happens on release.
 * - Crossing an item boundary fires a soft detent (sound, pitch by position) once per boundary.
 * - A bubble above the thumb shows the target time and item.
 * - Keyboard: arrows 5 s, Shift+arrows 15 s, Page keys by item, Home and End. No detent sound for
 *   keys; keyboard navigation stays silent.
 * - Progress is written to leaf elements (fill, thumb) as transforms; nothing inherits it.
 */
import { clamp } from "./motion.js";
import type { Player } from "./playerStore.js";
import { clockHtml, formatClock, SECTION_TITLES, type Timeline } from "./sampleContent.js";

export function scrubberMarkup(timeline: Timeline): string {
  const chapterStarts = new Set(timeline.sections.map((section) => section.firstIndex));
  const ticks = timeline.items
    .map((item) => {
      const left = ((item.startSec / timeline.durationSec) * 100).toFixed(3);
      return `<span class="scrubber-tick" data-index="${item.index}" ${chapterStarts.has(item.index) ? "data-chapter" : ""} style="inset-inline-start:${left}%"></span>`;
    })
    .join("");
  return `
    <div class="scrubber" id="scrubber" role="slider" tabindex="0" aria-label="Playback position"
      aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="${timeline.durationSec}" aria-valuenow="0" aria-valuetext="0:00">
      <div class="scrubber-track"><span class="scrubber-fill"></span></div>
      <div class="scrubber-ticks" aria-hidden="true">${ticks}</div>
      <span class="scrubber-thumb" aria-hidden="true"></span>
      <div class="scrubber-bubble" aria-hidden="true"><span class="num scrubber-bubble-time">0:00</span><span class="scrubber-bubble-item">Item 1 of ${timeline.items.length}</span></div>
    </div>
    <div class="scrubber-times num" aria-hidden="true"><span class="scrubber-elapsed">0:00</span><span class="scrubber-remaining">-${formatClock(timeline.durationSec)}</span></div>`;
}

export interface ScrubberOptions {
  root: HTMLElement;
  player: Player;
  timeline: Timeline;
  /** Called once per boundary crossed by a pointer scrub. */
  onDetent: (position: number) => void;
  /** Called after a keyboard item skip, so the caller can play the skip sound. */
  onKeyItemSkip: (direction: "next" | "previous") => void;
}

export function createScrubber(options: ScrubberOptions) {
  const { root, player, timeline } = options;
  const fill = root.querySelector<HTMLElement>(".scrubber-fill");
  const thumb = root.querySelector<HTMLElement>(".scrubber-thumb");
  const bubble = root.querySelector<HTMLElement>(".scrubber-bubble");
  const bubbleTime = root.querySelector<HTMLElement>(".scrubber-bubble-time");
  const bubbleItem = root.querySelector<HTMLElement>(".scrubber-bubble-item");
  const ticks = [...root.querySelectorAll<HTMLElement>(".scrubber-tick")];
  const scope = root.parentElement ?? root;
  const elapsed = scope.querySelector<HTMLElement>(".scrubber-elapsed");
  const remaining = scope.querySelector<HTMLElement>(".scrubber-remaining");
  const total = timeline.durationSec;

  let width = 1;
  let dragging = false;
  let activePointer = -1;
  let lastItem = 0;
  let lastDetentAt = Number.NEGATIVE_INFINITY;
  let lastWholeSecond = -1;
  const hysteresis = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--scrubber-detent-hysteresis"),
  );

  new ResizeObserver(() => {
    width = root.getBoundingClientRect().width || 1;
    paint(player.getState().time);
  }).observe(root);

  function itemLabel(index: number): string {
    return `Item ${index + 1} of ${timeline.items.length}`;
  }

  function paint(time: number): void {
    const fraction = clamp(time / total, 0, 1);
    if (fill) fill.style.setProperty("--player-progress", fraction.toFixed(5));
    if (thumb) thumb.style.transform = `translate3d(${(fraction * width).toFixed(2)}px, 0, 0)`;
    const whole = Math.floor(time);
    if (whole !== lastWholeSecond) {
      lastWholeSecond = whole;
      if (elapsed) elapsed.innerHTML = clockHtml(time);
      if (remaining) remaining.innerHTML = `-${clockHtml(total - time)}`;
      updateAria(time);
    }
    if (dragging && bubble && bubbleTime && bubbleItem) {
      bubbleTime.innerHTML = clockHtml(time);
      bubbleItem.textContent = itemLabel(player.itemAt(time));
      const half = bubble.offsetWidth / 2;
      const x = clamp(fraction * width, half, width - half) - half;
      bubble.style.transform = `translate3d(${x.toFixed(1)}px, 0, 0)`;
    }
  }

  function updateAria(time: number): void {
    const index = player.itemAt(time);
    const slug = timeline.items[index]?.section;
    root.setAttribute("aria-valuenow", String(Math.round(time)));
    root.setAttribute(
      "aria-valuetext",
      `${formatClock(time)} of ${formatClock(total)}, ${slug ? SECTION_TITLES[slug] : ""}, ${itemLabel(index).toLowerCase()}`,
    );
  }

  function paintTicks(time: number): void {
    for (const tick of ticks) {
      const index = Number(tick.dataset.index);
      const start = timeline.items[index]?.startSec ?? 0;
      if (start <= time) tick.setAttribute("data-played", "");
      else tick.removeAttribute("data-played");
    }
  }

  function timeFromEvent(event: PointerEvent): number {
    const rect = root.getBoundingClientRect();
    return clamp((event.clientX - rect.left) / rect.width, 0, 1) * total;
  }

  root.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || dragging) return;
    dragging = true;
    activePointer = event.pointerId;
    root.setPointerCapture(event.pointerId);
    root.dataset.dragging = "true";
    player.beginScrub();
    const time = timeFromEvent(event);
    lastItem = player.itemAt(time);
    player.scrubTo(time);
    paint(time);
    paintTicks(time);
  });

  root.addEventListener("pointermove", (event) => {
    if (!dragging || event.pointerId !== activePointer) return;
    const time = timeFromEvent(event);
    const item = player.itemAt(time);
    if (item !== lastItem) {
      // The boundary just crossed is the start of the later of the two items.
      const boundaryItem = Math.max(item, lastItem);
      const boundary = timeline.items[boundaryItem]?.startSec ?? 0;
      if (Math.abs(boundary - lastDetentAt) > hysteresis * total) {
        lastDetentAt = boundary;
        options.onDetent(clamp(boundary / total, 0, 1));
      }
      lastItem = item;
    }
    player.scrubTo(time);
    paint(time);
    paintTicks(time);
  });

  const finish = (event: PointerEvent): void => {
    if (!dragging || event.pointerId !== activePointer) return;
    dragging = false;
    activePointer = -1;
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
    delete root.dataset.dragging;
    const time = event.type === "pointercancel" ? player.getState().time : timeFromEvent(event);
    player.endScrub(time);
    lastDetentAt = Number.NEGATIVE_INFINITY;
  };
  root.addEventListener("pointerup", finish);
  root.addEventListener("pointercancel", finish);

  root.addEventListener("keydown", (event) => {
    const state = player.getState();
    const step = event.shiftKey ? 15 : 5;
    let handled = true;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowDown":
        player.seek(state.time - step);
        break;
      case "ArrowRight":
      case "ArrowUp":
        player.seek(state.time + step);
        break;
      case "PageDown":
        if (player.next()) options.onKeyItemSkip("next");
        break;
      case "PageUp":
        if (player.previous()) options.onKeyItemSkip("previous");
        break;
      case "Home":
        player.seek(0);
        break;
      case "End":
        player.seek(total);
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  });

  player.onFrame((time) => {
    if (dragging) return;
    paint(time);
  });
  player.subscribe((state) => {
    paintTicks(state.time);
    updateAria(state.time);
  });

  paint(player.getState().time);
  paintTicks(player.getState().time);
  return { paint, paintTicks };
}
