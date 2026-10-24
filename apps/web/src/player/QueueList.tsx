import { useRef } from "react";
import { swipeLeaves } from "../lib/swipeAway";
import { announce } from "./core/announcerDom";
import { createVelocityTracker, TAP_SLOP_PX } from "./core/gestureMath";
import { getPlayQueue } from "./core/playerRuntime";
import QueueRow, { type QueueGestures } from "./QueueRow";

/** How long a row slides out before the queue drops it: --duration-press-out and a frame. */
const LEAVE_MS = 180;
/** How long after a swipe the row's own click is not a play. */
const SWIPE_CLICK_MS = 400;

interface Press {
  pointerId: number;
  row: HTMLElement;
  id: string;
  x0: number;
  y0: number;
  dx: number;
  /** Undecided, a sideways swipe of ours, or a press the browser owns (a scroll or a drag). */
  mode: "idle" | "swipe" | "other";
}

/**
 * The queue in order (D162). A row moves by the browser's drag and drop: a long press lifts it under
 * a finger, a press and pull does with a mouse, and the list scrolls as it always did; the row it
 * is over shows an accent line on the edge it would join. A sideways swipe is ours: past the tap
 * slop it follows the finger, and on release the shared rule (lib/swipeAway.ts) says whether a
 * swipe to the left takes the row off or it springs back. The dots' menu does the same with a key
 * or a tap and says where the row went.
 */
export default function QueueList({ ids }: { ids: readonly string[] }) {
  const listRef = useRef<HTMLUListElement>(null);
  const press = useRef<Press | null>(null);
  const swipedUntil = useRef(0);
  const dragFrom = useRef<number | null>(null);
  const dropAt = useRef<number | null>(null);
  const marked = useRef<HTMLElement | null>(null);
  const tracker = useRef(createVelocityTracker());

  const rows = (): HTMLElement[] => [
    ...(listRef.current?.querySelectorAll<HTMLElement>(".player-queue-item") ?? []),
  ];
  const clearDrag = (): void => {
    for (const row of rows()) row.removeAttribute("data-dragging");
    marked.current?.removeAttribute("data-drop");
    marked.current = null;
    dragFrom.current = null;
    dropAt.current = null;
  };

  const gestures: QueueGestures = {
    onPointerDown(event, index) {
      if (!event.isPrimary || event.button !== 0) return;
      // The dots and the menu have presses of their own.
      if ((event.target as Element).closest(".player-queue-more, .player-queue-menu")) return;
      press.current = {
        pointerId: event.pointerId,
        row: event.currentTarget,
        id: ids[index] ?? "",
        x0: event.clientX,
        y0: event.clientY,
        dx: 0,
        mode: "idle",
      };
      tracker.current.reset({ value: event.clientX, t: event.timeStamp });
    },
    onPointerMove(event) {
      const current = press.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const dx = event.clientX - current.x0;
      const dy = event.clientY - current.y0;
      tracker.current.push(event.clientX, event.timeStamp);
      if (current.mode === "idle") {
        if (Math.abs(dx) >= TAP_SLOP_PX && Math.abs(dx) > Math.abs(dy)) {
          current.mode = "swipe";
          current.row.setPointerCapture(event.pointerId);
          current.row.dataset.swiping = "";
        } else if (Math.abs(dy) >= TAP_SLOP_PX) current.mode = "other";
      }
      if (current.mode !== "swipe") return;
      // Ours, not the player page's own pull.
      event.stopPropagation();
      current.dx = dx;
      // Left takes it away; right gives only a little, so the row says which way it goes.
      current.row.style.translate = `${dx < 0 ? dx : dx * 0.2}px 0`;
    },
    onPointerEnd(event) {
      const current = press.current;
      if (!current || current.pointerId !== event.pointerId) return;
      press.current = null;
      if (current.mode !== "swipe") return;
      event.stopPropagation();
      const { row, dx, id } = current;
      delete row.dataset.swiping;
      swipedUntil.current = event.timeStamp + SWIPE_CLICK_MS;
      if (dx < 0 && swipeLeaves(dx, row.offsetWidth, tracker.current.velocity())) {
        row.dataset.leaving = "";
        row.style.translate = `${-row.offsetWidth * 1.2}px 0`;
        window.setTimeout(() => getPlayQueue().remove(id), LEAVE_MS);
      } else row.style.translate = "";
    },
    swiped: () => performance.now() < swipedUntil.current,
    onDragStart(event, index) {
      // A finger already moving sideways is swiping, not dragging; the dots and the menu have
      // presses of their own, and a pull on them is not a reorder.
      if (
        press.current?.mode === "swipe" ||
        (event.target as Element).closest(".player-queue-more, .player-queue-menu")
      ) {
        event.preventDefault();
        return;
      }
      press.current = null;
      dragFrom.current = index;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", ids[index] ?? "");
      event.currentTarget.dataset.dragging = "";
    },
    onDragOver(event, index) {
      if (dragFrom.current === null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const box = event.currentTarget.getBoundingClientRect();
      const after = event.clientY > box.top + box.height / 2;
      if (marked.current !== event.currentTarget) marked.current?.removeAttribute("data-drop");
      marked.current = event.currentTarget;
      if (index !== dragFrom.current) event.currentTarget.dataset.drop = after ? "after" : "before";
      else event.currentTarget.removeAttribute("data-drop");
      dropAt.current = index + (after ? 1 : 0);
    },
    onDrop(event) {
      event.preventDefault();
      const from = dragFrom.current;
      let to = dropAt.current;
      clearDrag();
      if (from === null || to === null) return;
      if (from < to) to -= 1;
      if (to !== from) getPlayQueue().move(from, to);
    },
    onDragEnd: clearDrag,
    onMove(index, to, title) {
      if (to < 0 || to >= ids.length) return;
      const id = ids[index];
      getPlayQueue().move(index, to);
      announce(`${title}, ${to + 1} of ${ids.length}`);
      // The row's elements are kept and moved, but a moved node can lose focus: give it back.
      requestAnimationFrame(() => {
        listRef.current
          ?.querySelector<HTMLElement>(`[data-queue-id="${id}"] .player-queue-more`)
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
