import type { KeyboardEvent, PointerEvent, ToggleEvent } from "react";
import { menuItemClass, menuListClass } from "../design-system/menu";
import { longDateFromDigestId } from "./core/formatTime";
import { getPlayQueue, playQueueItem } from "./core/playerRuntime";
import { useQueueMeta } from "./hooks/useQueue";
import Icon from "./ui/LazyIcon";
import PlayerCover from "./ui/PlayerCover";

/** The gestures the list owns (QueueList.tsx): a row reports its presses with its index. */
export interface QueueGestures {
  onPointerDown(event: PointerEvent<HTMLElement>, index: number): void;
  onPointerMove(event: PointerEvent<HTMLElement>): void;
  onPointerEnd(event: PointerEvent<HTMLElement>): void;
  /** The grip at a row's end: a press on it lifts the row, and moving it reorders the queue. */
  onGripDown(event: PointerEvent<HTMLElement>, index: number): void;
  onGripMove(event: PointerEvent<HTMLElement>): void;
  onGripEnd(event: PointerEvent<HTMLElement>): void;
  onGripKey(event: KeyboardEvent<HTMLElement>, index: number): void;
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

/** How far under its dots the menu opens where anchor positioning is missing (as heroMenu.ts). */
const MENU_GAP_PX = 4;
const ITEM = '[role="menuitem"]:not(:disabled)';

/**
 * One queued item: its cover, its title and what it is. The row plays it now. The grip at its end lifts
 * it to a new place (a finger or a mouse; Up and Down move it from the keyboard), a swipe to either
 * side takes it off the queue, and the dots at its end open a menu that does both with a key or a
 * tap: Move up, Move down, Remove (D169, amended by the grip, 2026-11-02). The menu is the header's
 * More menu (hero.css): a popover under the dots, a bottom sheet on a phone.
 */
export default function QueueRow({ id, index, count, gestures }: QueueRowProps) {
  const meta = useQueueMeta(id);
  const title = meta?.title ?? longDateFromDigestId(id);
  const menuId = `player-queue-menu-${id}`;
  const closeMenu = (): void => document.getElementById(menuId)?.hidePopover();
  // Open, the menu takes focus on its first item and, without anchor positioning, is placed from
  // the dots' box as heroMenu.ts places the header's; closed, focus returns to the dots, which
  // heroMenu.ts does not do for a menu it was not installed for (the player stands on every page).
  const onToggle = (event: ToggleEvent<HTMLDivElement>): void => {
    const menu = event.currentTarget;
    const dots = menu.previousElementSibling as HTMLElement | null;
    if (event.newState !== "open") {
      if (menu.contains(document.activeElement) || document.activeElement === document.body)
        dots?.focus({ preventScroll: true });
      return;
    }
    menu.querySelector<HTMLElement>(ITEM)?.focus({ preventScroll: true });
    if (CSS.supports("top", "anchor(bottom)")) return;
    const box = dots?.getBoundingClientRect();
    if (!box) return;
    menu.style.setProperty("--menu-top", `${box.bottom + MENU_GAP_PX}px`);
    menu.style.setProperty("--menu-right", `${document.documentElement.clientWidth - box.right}px`);
  };
  // Up and Down move between the items, Home and End to the ends; Escape is the popover's own.
  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(ITEM)];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const n = items.length;
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: n - 1 }[event.key];
    if (to === undefined || n === 0) return;
    event.preventDefault();
    items[((to % n) + n) % n]?.focus({ preventScroll: true });
  };
  return (
    <li
      className="player-queue-item"
      data-queue-id={id}
      onPointerDown={(event) => gestures.onPointerDown(event, index)}
      onPointerMove={gestures.onPointerMove}
      onPointerUp={gestures.onPointerEnd}
      onPointerCancel={gestures.onPointerEnd}
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
        className="icon-btn player-queue-grip"
        type="button"
        aria-label={`Reorder ${title}, ${index + 1} of ${count}. Up and Down arrows move it`}
        onPointerDown={(event) => gestures.onGripDown(event, index)}
        onPointerMove={gestures.onGripMove}
        onPointerUp={gestures.onGripEnd}
        onPointerCancel={gestures.onGripEnd}
        onKeyDown={(event) => gestures.onGripKey(event, index)}
      >
        <Icon name="grip" />
      </button>
      <button
        className="icon-btn player-queue-more"
        type="button"
        popoverTarget={menuId}
        aria-haspopup="menu"
        aria-label={`More for ${title}`}
      >
        <Icon name="moreVert" />
      </button>
      <div
        id={menuId}
        className={`${menuListClass()} player-queue-menu`}
        popover="auto"
        role="menu"
        aria-label={title}
        onToggle={onToggle}
        onKeyDown={onMenuKey}
      >
        <button
          className={menuItemClass()}
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
          className={menuItemClass()}
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
          className={menuItemClass("danger")}
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
