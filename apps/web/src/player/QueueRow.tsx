import type { KeyboardEvent, PointerEvent } from "react";
import { longDateFromDigestId } from "./core/formatTime";
import { getPlayQueue, playQueueItem } from "./core/playerRuntime";
import { useQueueMeta } from "./hooks/useQueue";
import Icon from "./ui/LazyIcon";
import PlayerCover from "./ui/PlayerCover";

interface QueueRowProps {
  id: string;
  index: number;
  count: number;
  /** The handle's pointer and keys, from the list that owns the order (QueueList.tsx). */
  onHandlePointerDown(event: PointerEvent<HTMLElement>, index: number): void;
  onHandleKeyDown(event: KeyboardEvent<HTMLElement>, index: number, title: string): void;
}

/**
 * One queued item: its cover, its title and what it is. The row plays it now; the cross takes it
 * off the queue; the handle on the right drags it to another place, or moves it with the arrow keys.
 */
export default function QueueRow({
  id,
  index,
  count,
  onHandlePointerDown,
  onHandleKeyDown,
}: QueueRowProps) {
  const meta = useQueueMeta(id);
  const title = meta?.title ?? longDateFromDigestId(id);
  return (
    <li className="player-queue-item" data-queue-id={id}>
      <button className="player-queue-row" type="button" onClick={() => playQueueItem(id)}>
        <span className="player-queue-thumb">
          {meta ? <PlayerCover cover={meta.cover} weekly={meta.weekly} size="thumb" /> : null}
        </span>
        <span className="player-upnext-text">
          <span className="player-upnext-date">{title}</span>
          <span className="player-upnext-hint">{meta?.caption ?? " "}</span>
        </span>
      </button>
      <button
        className="icon-btn player-queue-remove"
        type="button"
        aria-label={`Remove ${title} from the queue`}
        onClick={() => getPlayQueue().remove(id)}
      >
        <Icon name="close" className="icon" />
      </button>
      <button
        className="icon-btn player-queue-handle"
        type="button"
        data-queue-handle
        aria-label={`Move ${title}, ${index + 1} of ${count}`}
        aria-describedby="player-queue-move-hint"
        onPointerDown={(event) => onHandlePointerDown(event, index)}
        onKeyDown={(event) => onHandleKeyDown(event, index, title)}
      >
        <Icon name="dragHandle" className="icon" />
      </button>
    </li>
  );
}
