import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import { longDateFromDigestId } from "./core/formatTime";
import { playQueueItem } from "./core/playerRuntime";
import { useQueueMeta } from "./hooks/useQueue";
import QueueRowMenu from "./QueueRowMenu";
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
  onMove(index: number, to: number): void;
}

interface QueueRowProps {
  id: string;
  /** Its place in the list, the playing row included, as the gestures count it and it is called. */
  index: number;
  count: number;
  /** The item playing now (D346), or a row put above it, which does not start by itself (D357). */
  state?: "current" | "before";
  gestures: QueueGestures;
}

/**
 * The red strip behind a row being swiped away, with the bin on the side the row left (player.css).
 * The row keeps its own look and slides over it (owner, 2026-11-03: "a red strip in the background,
 * and not to change the row itself to turn red as I need visibility").
 */
export function QueueDeleteMark() {
  return (
    <span className="player-queue-delete" aria-hidden="true">
      <Icon name="trash" />
    </span>
  );
}

/**
 * One queued item: its cover, its title and what it is. The row plays it now. The two bars at its end
 * are its handle (owner, 2026-11-02, after D169's dots): a press on them lifts the row to a new
 * place, with a finger or a mouse, and Up and Down move it from the keyboard, Delete takes it off;
 * a swipe to either side takes it off too. A mouse also gets a ⋮ on hover (owner, 2026-11-03) with
 * the row's other actions; a phone never draws it (player.css). The playing row is moved the same
 * way (D349), and any row may go above it (D357).
 */
export default function QueueRow({ id, index, count, state, gestures }: QueueRowProps) {
  const meta = useQueueMeta(id);
  const title = meta?.title ?? longDateFromDigestId(id);
  const playing = state === "current";
  const name = `Move ${title}, ${playing ? "playing now, " : ""}${index + 1} of ${count}. Up and Down arrows move it, Delete removes it`;
  return (
    <li
      className="player-queue-item"
      data-queue-id={id}
      data-state={state}
      aria-current={playing ? "true" : undefined}
      onPointerDown={(event) => gestures.onPointerDown(event, index)}
      onPointerMove={gestures.onPointerMove}
      onPointerUp={gestures.onPointerEnd}
      onPointerCancel={gestures.onPointerEnd}
    >
      <QueueDeleteMark />
      <div className="player-queue-face">
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
        <QueueRowMenu id={id} title={title} subtitle={meta?.caption} />
        <button
          className="icon-btn player-queue-grip"
          type="button"
          // The anchor a hold's menu hangs from on a touch screen, where the dots are hidden (player.css).
          style={{ "--queue-anchor": `--queue-more-${id}` } as CSSProperties}
          aria-label={name}
          onPointerDown={(event) => gestures.onGripDown(event, index)}
          onPointerMove={gestures.onGripMove}
          onPointerUp={gestures.onGripEnd}
          onPointerCancel={gestures.onGripEnd}
          onKeyDown={(event) => gestures.onGripKey(event, index)}
        >
          <Icon name="grip" />
        </button>
      </div>
    </li>
  );
}
