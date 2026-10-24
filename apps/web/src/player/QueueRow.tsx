import type { DragEvent, PointerEvent, ToggleEvent } from "react";
import { longDateFromDigestId } from "./core/formatTime";
import { getPlayQueue, playQueueItem } from "./core/playerRuntime";
import { useQueueMeta } from "./hooks/useQueue";
import Icon from "./ui/LazyIcon";
import PlayerCover from "./ui/PlayerCover";

/** The gestures the list owns (QueueList.tsx): a row reports its presses and drags with its index. */
export interface QueueGestures {
  onPointerDown(event: PointerEvent<HTMLElement>, index: number): void;
  onPointerMove(event: PointerEvent<HTMLElement>): void;
  onPointerEnd(event: PointerEvent<HTMLElement>): void;
  onDragStart(event: DragEvent<HTMLElement>, index: number): void;
  onDragOver(event: DragEvent<HTMLElement>, index: number): void;
  onDrop(event: DragEvent<HTMLElement>): void;
  onDragEnd(): void;
  /** True just after a swipe, so the row's click does not play what the finger meant to move. */
  swiped(): boolean;
  onMove(index: number, to: number, title: string): void;
}

interface QueueRowProps {
  id: string;
  index: number;
  count: number;
  gestures: QueueGestures;
}

/** How far under its dots the menu opens where anchor positioning is missing (hero.css). */
const MENU_GAP_PX = 8;

/**
 * One queued item: its cover, its title and what it is. The row plays it now. A drag moves it (a
 * long press with a finger, a press and pull with a mouse: the browser's own drag and drop), a swipe
 * to the left takes it off the queue, and the dots at its end open a menu that does both with a key
 * or a tap: Move up, Move down, Remove (D162). The menu is the header's More menu (hero.css): a
 * popover under the dots, a bottom sheet on a phone.
 */
export default function QueueRow({ id, index, count, gestures }: QueueRowProps) {
  const meta = useQueueMeta(id);
  const title = meta?.title ?? longDateFromDigestId(id);
  const menuId = `player-queue-menu-${id}`;
  const closeMenu = (): void => document.getElementById(menuId)?.hidePopover();
  // Without anchor positioning the menu is placed from the dots' box, as the header's menu is.
  const place = (event: ToggleEvent<HTMLDivElement>): void => {
    if (event.newState !== "open") return;
    const box = event.currentTarget.previousElementSibling?.getBoundingClientRect();
    if (!box) return;
    event.currentTarget.style.setProperty("--menu-top", `${box.bottom + MENU_GAP_PX}px`);
    event.currentTarget.style.setProperty("--menu-right", `${window.innerWidth - box.right}px`);
  };
  return (
    <li
      className="player-queue-item"
      data-queue-id={id}
      draggable
      onPointerDown={(event) => gestures.onPointerDown(event, index)}
      onPointerMove={gestures.onPointerMove}
      onPointerUp={gestures.onPointerEnd}
      onPointerCancel={gestures.onPointerEnd}
      onDragStart={(event) => gestures.onDragStart(event, index)}
      onDragOver={(event) => gestures.onDragOver(event, index)}
      onDrop={gestures.onDrop}
      onDragEnd={gestures.onDragEnd}
    >
      <button
        className="player-queue-row"
        type="button"
        onClick={() => {
          if (!gestures.swiped()) playQueueItem(id);
        }}
      >
        <span className="player-queue-thumb">
          {meta ? <PlayerCover cover={meta.cover} weekly={meta.weekly} size="thumb" /> : null}
        </span>
        <span className="player-upnext-text">
          <span className="player-upnext-date">{title}</span>
          <span className="player-upnext-hint">{meta?.caption ?? " "}</span>
        </span>
      </button>
      <button
        className="icon-btn player-queue-more"
        type="button"
        popoverTarget={menuId}
        aria-haspopup="menu"
        aria-label={`More for ${title}`}
      >
        <Icon name="moreVert" className="icon" />
      </button>
      <div
        id={menuId}
        className="hero-menu-list menu-sheet player-queue-menu"
        popover="auto"
        role="menu"
        aria-label={title}
        onToggle={place}
      >
        <button
          className="hero-menu-item"
          type="button"
          role="menuitem"
          disabled={index === 0}
          onClick={() => {
            closeMenu();
            gestures.onMove(index, index - 1, title);
          }}
        >
          Move up
        </button>
        <button
          className="hero-menu-item"
          type="button"
          role="menuitem"
          disabled={index === count - 1}
          onClick={() => {
            closeMenu();
            gestures.onMove(index, index + 1, title);
          }}
        >
          Move down
        </button>
        <button
          className="hero-menu-item hero-menu-delete"
          type="button"
          role="menuitem"
          onClick={() => {
            closeMenu();
            getPlayQueue().remove(id);
          }}
        >
          Remove from queue
        </button>
      </div>
    </li>
  );
}
