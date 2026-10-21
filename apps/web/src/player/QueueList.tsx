import { type KeyboardEvent, type PointerEvent, useRef } from "react";
import { announce } from "./core/announcerDom";
import { getPlayQueue } from "./core/playerRuntime";
import QueueRow from "./QueueRow";

interface Drag {
  pointerId: number;
  from: number;
  to: number;
  y0: number;
  /** One row's height and the gap after it: how far a neighbour steps aside. */
  step: number;
  items: HTMLElement[];
}

/**
 * The queue in order. A row's handle drags it to another place: the row follows the finger or the
 * mouse and its neighbours step aside (transform only, so nothing around the list moves), and the
 * new order is kept on release. With the keyboard, the handle's arrow keys move the row one place
 * and say where it now is.
 */
export default function QueueList({ ids }: { ids: readonly string[] }) {
  const listRef = useRef<HTMLUListElement>(null);
  const drag = useRef<Drag | null>(null);

  function onHandlePointerDown(event: PointerEvent<HTMLElement>, index: number): void {
    if (event.button !== 0 || !event.isPrimary) return;
    // The handle's own gesture: never the player page's dismissal.
    event.stopPropagation();
    event.preventDefault();
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>(".player-queue-item") ?? [])];
    const row = items[index];
    if (!row) return;
    const below = items[index + 1] ?? items[index - 1];
    const box = row.getBoundingClientRect();
    const step = below ? Math.abs(below.getBoundingClientRect().top - box.top) : box.height;
    event.currentTarget.setPointerCapture(event.pointerId);
    row.setAttribute("data-dragging", "");
    drag.current = {
      pointerId: event.pointerId,
      from: index,
      to: index,
      y0: event.clientY,
      step,
      items,
    };
  }

  function onPointerMove(event: PointerEvent<HTMLElement>): void {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const { from, step, items } = current;
    const dy = Math.min(
      Math.max(event.clientY - current.y0, -from * step),
      (items.length - 1 - from) * step,
    );
    const to = from + Math.round(dy / step);
    current.to = to;
    items.forEach((item, i) => {
      const shift = i === from ? dy : from < i && i <= to ? -step : to <= i && i < from ? step : 0;
      item.style.transform = shift ? `translate3d(0, ${shift}px, 0)` : "";
    });
  }

  function onPointerEnd(event: PointerEvent<HTMLElement>): void {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    drag.current = null;
    // Cleared and reordered in the same task, so the next frame draws the new order at rest.
    for (const item of current.items) {
      item.style.transform = "";
      item.removeAttribute("data-dragging");
    }
    if (current.to !== current.from) getPlayQueue().move(current.from, current.to);
  }

  function onHandleKeyDown(event: KeyboardEvent<HTMLElement>, index: number, title: string): void {
    const by = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (by === 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    event.stopPropagation();
    const to = Math.min(Math.max(index + by, 0), ids.length - 1);
    if (to === index) return;
    const id = ids[index];
    getPlayQueue().move(index, to);
    announce(`${title}, ${to + 1} of ${ids.length}`);
    // The row's elements are kept and moved, but a moved node can lose focus: give it back.
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector<HTMLElement>(`[data-queue-id="${id}"] [data-queue-handle]`)
        ?.focus({ preventScroll: true });
    });
  }

  return (
    <>
      <p className="sr-only" id="player-queue-move-hint">
        Arrow up and down move it.
      </p>
      <ul
        className="player-queue-list"
        ref={listRef}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        {ids.map((id, index) => (
          <QueueRow
            key={id}
            id={id}
            index={index}
            count={ids.length}
            onHandlePointerDown={onHandlePointerDown}
            onHandleKeyDown={onHandleKeyDown}
          />
        ))}
      </ul>
    </>
  );
}
