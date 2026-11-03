import { useEffect, useLayoutEffect, useRef } from "react";
import { announce } from "./core/announcerDom";
import { TAP_SLOP_PX } from "./core/gestureMath";
import { getPlayQueue } from "./core/playerRuntime";
import QueueRow, { type QueueGestures } from "./QueueRow";
import { getHaptics } from "./sound/soundController";
import { useRowSwipe } from "./useRowSwipe";

/** The edge of the scrolling column, within which a lifted row scrolls it, and the most it scrolls a frame. */
const EDGE_PX = 56;
const EDGE_MAX_STEP_PX = 14;

/** Where each row stood, by id, from the top of the window: what a drop glides the rows from. */
type Places = Map<string, number>;

/**
 * Glides each row from where it stood to where the list now draws it (a FLIP): the dropped row
 * from under the finger into its place, and the rows around it into theirs, on the spring that
 * settles without overshoot (tokens.css). A drop that snapped into place read as a jump. Not
 * with reduced motion, and never for a keyboard move, which is repeated and must not lag.
 */
function glide(list: HTMLElement | null, before: Places): void {
  if (!list || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const root = getComputedStyle(document.documentElement);
  const duration = Number.parseFloat(root.getPropertyValue("--duration-spring-settle")) || 0;
  const easing = root.getPropertyValue("--ease-spring-settle").trim() || "ease-out";
  for (const row of list.querySelectorAll<HTMLElement>(".player-queue-item")) {
    const was = before.get(row.dataset.queueId ?? "");
    if (was === undefined) continue;
    const dy = was - row.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) continue;
    row.animate([{ translate: `0 ${dy}px` }, { translate: "0 0" }], { duration, easing });
  }
}

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
 * The item playing now heads the list as row 0 (`lead`, D346) and is lifted the same way (owner,
 * 2026-11-03): let go lower, it plays on and the rows it passed are skipped (D349), so it heads the
 * list again. Nothing is put above it: a queued row lifted to the top stops under it.
 */
export default function QueueList({ ids, lead }: { ids: readonly string[]; lead?: string | null }) {
  const listRef = useRef<HTMLUListElement>(null);
  const swipe = useRowSwipe();
  const lift = useRef<Lift | null>(null);
  /** Where the rows stood when a drop changed the order, for the glide once the list redraws. */
  const pending = useRef<Places | null>(null);
  useLayoutEffect(() => {
    const before = pending.current;
    if (!before) return;
    pending.current = null;
    glide(listRef.current, before);
  });
  /** Every row in the list's order: the playing one first, when it is shown. */
  const all = lead ? [lead, ...ids] : [...ids];
  /** The first place a queued row may take: under the playing row, when it is shown. */
  const top = lead ? 1 : 0;
  // The list moves to the item that has just begun, so it does not stay scrolled below it. Not on
  // opening the view: switching tabs keeps the page where it was (owner, 2026-11-02).
  useEffect(() => {
    if (lead && lastLead !== lead && lastLead !== null)
      listRef.current
        ?.querySelector<HTMLElement>('[data-state="current"]')
        ?.scrollIntoView({ block: "start" });
    if (lead) lastLead = lead;
  }, [lead]);

  /** Puts row `from` at place `to`, both counted in `all`, and says where it went. */
  const put = (from: number, to: number): void => {
    if (lead && from === 0) {
      // The playing row let go lower: it plays on, and what it passed is skipped.
      getPlayQueue().skip(to);
      announce(to === 1 ? "Skipped 1 podcast" : `Skipped ${to} podcasts`);
      return;
    }
    const at = Math.max(top, to);
    getPlayQueue().move(from - top, at - top);
    const title = rows()[from]?.querySelector(".player-upnext-date")?.textContent ?? "";
    announce(`${title}, ${at - top + 1} of ${ids.length}`);
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
      // Nothing goes above the playing row.
      if (index < current.from && index >= top && at < centre) to = Math.min(to, index);
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
    const before: Places = new Map(
      rows().map((row) => [row.dataset.queueId ?? "", row.getBoundingClientRect().top]),
    );
    // The rows go back to their own places at once: the list draws them in the new order next.
    listRef.current?.setAttribute("data-settling", "");
    for (const row of rows()) {
      row.style.translate = "";
      row.removeAttribute("data-dragging");
    }
    if (put && current.to !== current.from) {
      pending.current = before;
      putRow(current.from, current.to);
      // The row's elements are kept and moved, but a moved node can lose focus: give it back.
      const id = all[current.from];
      requestAnimationFrame(() => {
        listRef.current
          ?.querySelector<HTMLElement>(`[data-queue-id="${id}"] .player-queue-grip`)
          ?.focus({ preventScroll: true });
      });
    } else {
      // Let go where it was taken (or a cancel): it glides back home.
      glide(listRef.current, before);
    }
    requestAnimationFrame(() => {
      listRef.current?.removeAttribute("data-settling");
      // A drop the list never redrew for (nothing changed after all) has nothing to glide.
      pending.current = null;
    });
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
      if (to < top || to >= all.length || (lead && index === 0 && to < 1)) return;
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
          place={index - top}
          count={ids.length}
          playing={lead !== undefined && lead !== null && index === 0}
          gestures={gestures}
        />
      ))}
    </ul>
  );
}
