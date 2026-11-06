import { useEffect, useLayoutEffect, useRef } from "react";
import { announce } from "./core/announcerDom";
import { TAP_SLOP_PX } from "./core/gestureMath";
import { getPlayQueue } from "./core/playerRuntime";
import { moveInQueue } from "./core/playQueue";
import QueueRow, { type QueueGestures } from "./QueueRow";
import { capture, measure, play, settleNow } from "./queueFlip";
import { getHaptics } from "./sound/soundController";
import { useRowSwipe } from "./useRowSwipe";

/** The edge of the scrolling column, within which a lifted row scrolls it, and the most it scrolls a frame. */
const EDGE_PX = 56;
const EDGE_MAX_STEP_PX = 14;

/** The item last shown as playing, kept across the view's mounts: a new one is what moves the list. */
let lastLead: string | null = null;

/** A row lifted by its grip: where it began, and what it passes over. */
interface Lift {
  pointerId: number;
  grip: HTMLElement;
  row: HTMLElement;
  from: number;
  y0: number;
  y: number;
  scroller: HTMLElement | null;
  scroll0: number;
  /** Each row's centre when the lift began, in the page's own scrolled coordinates. */
  centres: number[];
  /** The distance the rows below shift for the lifted one: its height and the gap. */
  step: number;
  to: number;
  frame: number;
}

/** The nearest ancestor that scrolls, which the list lives in (the page on a phone, the column wide). */
function scrollParent(node: HTMLElement): HTMLElement | null {
  for (let at = node.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if ((overflowY === "auto" || overflowY === "scroll") && at.scrollHeight > at.clientHeight)
      return at;
  }
  return null;
}

/**
 * The queue in order (D169). A row is lifted by the grip at its end: a press on it takes the row
 * under the finger (or the mouse), the rows it passes make room, the column scrolls when it is held
 * near an edge, and the lift's end puts the row where it is. The browser's drag and drop, which a
 * long press never reliably started on a phone, is gone. A sideways swipe is the row's own: past the
 * tap slop it follows the finger, and on release the shared rule (lib/swipeAway.ts) says whether a
 * swipe to either side takes the row off or it springs back. The dots' menu and the grip's Up and
 * Down keys do the same with the keyboard and say where the row went.
 *
 * The item playing now (`lead`) is a row like the others (D349), and the list plays top to bottom
 * (D357): any row may go above it, where it stays and never starts by itself (`above`), and the
 * playing row let go lower keeps the rows it passed above it. With nothing put above, it heads the
 * list (D346).
 */
export default function QueueList({
  above = [],
  ids,
  lead,
}: {
  above?: readonly string[];
  ids: readonly string[];
  lead?: string | null;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const swipe = useRowSwipe();
  const lift = useRef<Lift | null>(null);
  /** Every row in the list's order: above, the playing one, then what is to come. */
  const all = [...above, ...(lead ? [lead] : []), ...ids];
  /** The panel the list and Suggested share, whose rows glide together (queueFlip.ts). */
  const panel = (): HTMLElement | null => listRef.current?.parentElement ?? null;
  // The list moves to the item that has just begun, so it does not stay scrolled below it. Not on
  // opening the view: switching tabs keeps the page where it was (owner, 2026-11-02).
  useEffect(() => {
    if (lead && lastLead !== lead && lastLead !== null)
      listRef.current
        ?.querySelector<HTMLElement>('[data-state="current"]')
        ?.scrollIntoView({ block: "start" });
    if (lead) lastLead = lead;
  }, [lead]);
  // The list changed under a held row (the playing item ended, another tab queued one): the places
  // it was lifted among are gone, so it goes back home and nothing moves.
  const order = all.join(" ");
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new order ends the lift
  useLayoutEffect(() => {
    if (lift.current) endLift(false);
  }, [order]);

  // A sideways swipe keeps the page still (useRowSwipe.ts); React's own touch listeners are passive.
  useEffect(() => {
    const list = listRef.current;
    list?.addEventListener("touchmove", swipe.onTouchMove, { passive: false });
    return () => list?.removeEventListener("touchmove", swipe.onTouchMove);
  }, [swipe.onTouchMove]);

  // A hold on a row opens its menu as the Library's cards do (owner, 2026-11-03), so a phone needs
  // no dots. The script is the Library's own and installs once for the document.
  useEffect(() => {
    void import("../scripts/cardHold").then((hold) => hold.installCardHold());
  }, []);

  /** Puts row `from` at place `to`, both counted in `all`, and says where it went. */
  const put = (from: number, to: number): void => {
    const target = Math.min(Math.max(to, 0), all.length - 1);
    if (target === from) return;
    const title = rows()[from]?.querySelector(".player-upnext-date")?.textContent ?? "";
    getPlayQueue().arrange(moveInQueue(all, from, target));
    announce(`${title}, ${target + 1} of ${all.length}`);
  };

  const rows = (): HTMLElement[] => [
    ...(listRef.current?.querySelectorAll<HTMLElement>(".player-queue-item") ?? []),
  ];
  /** Shifts every other row by its share of the lift: those the lifted row has passed make room. */
  const settleRows = (current: Lift): void => {
    const dragged = current.centres[current.from] ?? 0;
    const at =
      dragged + (current.y - current.y0) + ((current.scroller?.scrollTop ?? 0) - current.scroll0);
    // The place it would take is the number of rows whose centre it has passed.
    let to = current.from;
    current.centres.forEach((centre, index) => {
      if (index < current.from && at < centre) to = Math.min(to, index);
      if (index > current.from && at > centre) to = Math.max(to, index);
    });
    // A tick for each place the held row moves to, as a wheel's detent.
    if (to !== current.to) getHaptics().fire("detent");
    current.to = to;
    rows().forEach((row, index) => {
      if (index === current.from) return;
      const shift =
        current.from < to && index > current.from && index <= to
          ? -current.step
          : current.to < current.from && index < current.from && index >= to
            ? current.step
            : 0;
      row.style.translate = shift ? `0 ${shift}px` : "";
    });
  };

  const placeLifted = (current: Lift): void => {
    const scrolled = (current.scroller?.scrollTop ?? 0) - current.scroll0;
    current.row.style.translate = `0 ${current.y - current.y0 + scrolled}px`;
    settleRows(current);
  };

  /** While held near an edge the column scrolls, and the row keeps its place under the finger. */
  const autoScroll = (current: Lift): void => {
    cancelAnimationFrame(current.frame);
    const scroller = current.scroller;
    if (!scroller || lift.current !== current) return;
    const box = scroller.getBoundingClientRect();
    // Only toward the edge the finger is travelling to, and only past where the press began: a row
    // lifted near the bottom (the list sits low under the cover) used to scroll at once and pass
    // every row on a short drag. The push grows with the square of the depth, so it starts gently.
    const low = Math.max(box.bottom - EDGE_PX, current.y0 + TAP_SLOP_PX);
    const high = Math.min(box.top + EDGE_PX, current.y0 - TAP_SLOP_PX);
    const depth =
      current.y > low
        ? Math.min(1, (current.y - low) / Math.max(1, box.bottom - low))
        : current.y < high
          ? -Math.min(1, (high - current.y) / Math.max(1, high - box.top))
          : 0;
    const near = Math.sign(depth) * depth * depth;
    if (near !== 0) {
      scroller.scrollTop += near * EDGE_MAX_STEP_PX;
      placeLifted(current);
    }
    current.frame = requestAnimationFrame(() => autoScroll(current));
  };

  const putRow = put;
  const endLift = (put: boolean): void => {
    const current = lift.current;
    if (!current) return;
    lift.current = null;
    cancelAnimationFrame(current.frame);
    try {
      current.grip.releasePointerCapture(current.pointerId);
    } catch {
      // The pointer was already let go (a cancel).
    }
    // Where each row stands now, the held one under the finger, so the drop glides from there.
    const before = measure(listRef.current);
    // The rows go back to their own places at once: the list draws them in the new order next.
    listRef.current?.setAttribute("data-settling", "");
    for (const row of rows()) {
      row.style.translate = "";
      row.removeAttribute("data-dragging");
    }
    capture(panel(), before);
    if (put && current.to !== current.from) {
      putRow(current.from, current.to);
      // The row's elements are kept and moved, but a moved node can lose focus: give it back.
      const id = all[current.from];
      requestAnimationFrame(() => {
        listRef.current
          ?.querySelector<HTMLElement>(`[data-queue-id="${id}"] .player-queue-grip`)
          ?.focus({ preventScroll: true });
      });
    } else {
      // Let go where it was taken (or a cancel): it glides back home, with no redraw to wait for.
      play(panel());
    }
    requestAnimationFrame(() => listRef.current?.removeAttribute("data-settling"));
  };

  const gestures: QueueGestures = {
    onPointerDown: (event, index) => swipe.onPointerDown(event, all[index] ?? ""),
    onPointerMove: swipe.onPointerMove,
    onPointerEnd: swipe.onPointerEnd,
    swiped: swipe.swiped,
    onGripDown(event, index) {
      if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
      const row = event.currentTarget.closest<HTMLElement>(".player-queue-item");
      if (!row || lift.current) return;
      // A glide still under way ends first, so the places the lift counts are the real ones.
      settleNow(panel());
      const all = rows();
      const scroller = scrollParent(row);
      const box = row.getBoundingClientRect();
      const gap = Number.parseFloat(getComputedStyle(listRef.current ?? row).rowGap) || 0;
      event.currentTarget.setPointerCapture(event.pointerId);
      // A held grip is no tap on the row under it, and the page's own pull must not take the press.
      event.stopPropagation();
      const current: Lift = {
        pointerId: event.pointerId,
        grip: event.currentTarget,
        row,
        from: index,
        y0: event.clientY,
        y: event.clientY,
        scroller,
        scroll0: scroller?.scrollTop ?? 0,
        centres: all.map((el) => {
          const rect = el.getBoundingClientRect();
          return rect.top + rect.height / 2;
        }),
        step: box.height + gap,
        to: index,
        frame: 0,
      };
      lift.current = current;
      row.dataset.dragging = "";
      getHaptics().fire("detent");
      autoScroll(current);
    },
    onGripMove(event) {
      const current = lift.current;
      if (!current || current.pointerId !== event.pointerId) return;
      event.stopPropagation();
      current.y = event.clientY;
      placeLifted(current);
    },
    onGripEnd(event) {
      const current = lift.current;
      if (!current || current.pointerId !== event.pointerId) return;
      event.stopPropagation();
      endLift(event.type !== "pointercancel");
    },
    onGripKey(event, index) {
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        const id = all[index];
        if (id) getPlayQueue().remove(id);
        return;
      }
      const to = { ArrowUp: index - 1, ArrowDown: index + 1 }[event.key];
      if (to === undefined) return;
      event.preventDefault();
      gestures.onMove(index, to);
    },
    onMove(index, to) {
      if (to < 0 || to >= all.length) return;
      const id = all[index];
      put(index, to);
      // The row's elements are kept and moved, but a moved node can lose focus: give it back.
      requestAnimationFrame(() => {
        listRef.current
          ?.querySelector<HTMLElement>(`[data-queue-id="${id}"] .player-queue-grip`)
          ?.focus({ preventScroll: true });
      });
    },
  };

  return (
    <ul className="player-queue-list" ref={listRef}>
      {all.map((id, index) => (
        <QueueRow
          key={id}
          id={id}
          index={index}
          count={all.length}
          state={id === lead ? "current" : lead && index < above.length ? "before" : undefined}
          gestures={gestures}
        />
      ))}
    </ul>
  );
}
