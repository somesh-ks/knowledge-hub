import { useRef } from "react";
import { announce } from "./core/announcerDom";
import { TAP_SLOP_PX } from "./core/gestureMath";
import { getPlayQueue } from "./core/playerRuntime";
import QueueRow, { type QueueGestures } from "./QueueRow";
import { useRowSwipe } from "./useRowSwipe";

/** The edge of the scrolling column, within which a lifted row scrolls it, and the most it scrolls a frame. */
const EDGE_PX = 56;
const EDGE_MAX_STEP_PX = 14;

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
 */
export default function QueueList({ ids }: { ids: readonly string[] }) {
  const listRef = useRef<HTMLUListElement>(null);
  const swipe = useRowSwipe();
  const lift = useRef<Lift | null>(null);

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
    // Only toward the edge the finger is travelling to: pressing near one scrolls nothing by itself.
    const travelled = current.y - current.y0;
    const near =
      travelled < -TAP_SLOP_PX && current.y < box.top + EDGE_PX
        ? -(1 - Math.max(0, current.y - box.top) / EDGE_PX)
        : travelled > TAP_SLOP_PX && current.y > box.bottom - EDGE_PX
          ? 1 - Math.max(0, box.bottom - current.y) / EDGE_PX
          : 0;
    if (near !== 0) {
      scroller.scrollTop += near * EDGE_MAX_STEP_PX;
      placeLifted(current);
    }
    current.frame = requestAnimationFrame(() => autoScroll(current));
  };

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
    // The rows go back to their own places at once: the list draws them in the new order next.
    listRef.current?.setAttribute("data-settling", "");
    for (const row of rows()) {
      row.style.translate = "";
      row.removeAttribute("data-dragging");
    }
    if (put && current.to !== current.from) {
      getPlayQueue().move(current.from, current.to);
      const title = current.row.querySelector(".player-upnext-date")?.textContent ?? "";
      announce(`${title}, ${current.to + 1} of ${ids.length}`);
      // The row's elements are kept and moved, but a moved node can lose focus: give it back.
      const id = ids[current.from];
      requestAnimationFrame(() => {
        listRef.current
          ?.querySelector<HTMLElement>(`[data-queue-id="${id}"] .player-queue-grip`)
          ?.focus({ preventScroll: true });
      });
    }
    requestAnimationFrame(() => listRef.current?.removeAttribute("data-settling"));
  };

  const gestures: QueueGestures = {
    onPointerDown: (event, index) => swipe.onPointerDown(event, ids[index] ?? ""),
    onPointerMove: swipe.onPointerMove,
    onPointerEnd: swipe.onPointerEnd,
    swiped: swipe.swiped,
    onGripDown(event, index) {
      if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
      const row = event.currentTarget.closest<HTMLElement>(".player-queue-item");
      if (!row || lift.current) return;
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
        const id = ids[index];
        if (id) getPlayQueue().remove(id);
        return;
      }
      const to = { ArrowUp: index - 1, ArrowDown: index + 1 }[event.key];
      if (to === undefined) return;
      event.preventDefault();
      const title = rows()[index]?.querySelector(".player-upnext-date")?.textContent ?? "";
      gestures.onMove(index, to, title);
    },
    onMove(index, to, title) {
      if (to < 0 || to >= ids.length) return;
      const id = ids[index];
      getPlayQueue().move(index, to);
      announce(`${title}, ${to + 1} of ${ids.length}`);
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
      {ids.map((id, index) => (
        <QueueRow key={id} id={id} index={index} count={ids.length} gestures={gestures} />
      ))}
    </ul>
  );
}
