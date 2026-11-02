import type { KeyboardEvent, PointerEvent } from "react";
import { longDateFromDigestId } from "./core/formatTime";
import { playQueueItem } from "./core/playerRuntime";
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

/**
 * One queued item: its cover, its title and what it is. The row plays it now. The two bars at its end
 * are its only control (owner, 2026-11-02, after D169's dots): a press on them lifts the row to a new
 * place, with a finger or a mouse, and Up and Down move it from the keyboard, Delete takes it off;
 * a swipe to either side takes it off too. There is no menu.
 */
export default function QueueRow({ id, index, count, gestures }: QueueRowProps) {
  const meta = useQueueMeta(id);
  const title = meta?.title ?? longDateFromDigestId(id);
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
        aria-label={`Move ${title}, ${index + 1} of ${count}. Up and Down arrows move it, Delete removes it`}
        onPointerDown={(event) => gestures.onGripDown(event, index)}
        onPointerMove={gestures.onGripMove}
        onPointerUp={gestures.onGripEnd}
        onPointerCancel={gestures.onGripEnd}
        onKeyDown={(event) => gestures.onGripKey(event, index)}
      >
        <Icon name="grip" />
      </button>
    </li>
  );
}
