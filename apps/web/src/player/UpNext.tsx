import { useEffect, useRef, useState } from "react";
import { longDateFromDigestId } from "./core/formatTime";
import { getPlayQueue, loadSuggested, playQueueItem } from "./core/playerRuntime";
import { usePlayerState } from "./hooks/usePlayer";
import { useQueueMeta, useQueueView } from "./hooks/useQueue";
import QueueList from "./QueueList";
import { QueueDeleteMark } from "./QueueRow";
import Icon from "./ui/LazyIcon";
import PlayerCover from "./ui/PlayerCover";
import { useRowSwipe } from "./useRowSwipe";

/**
 * The suggested items after what is playing, the list Autoplay draws from (core/suggested.ts).
 * Null until the site's list has been read; read again when the playing item changes.
 */
function useSuggested(queued: readonly string[]): string[] | null {
  const currentId = usePlayerState().track?.digest.id ?? null;
  const [ids, setIds] = useState<string[] | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the list is read again for each item and queue change
  useEffect(() => {
    let live = true;
    void loadSuggested().then((loaded) => {
      if (live) setIds(loaded);
    });
    return () => {
      live = false;
    };
  }, [currentId, queued]);
  return ids;
}

/** One suggested item: the queue row's look, and a plus at its end that queues it. */
function SuggestedRow({ id }: { id: string }) {
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
          <span className="player-upnext-hint">{meta?.caption ?? " "}</span>
        </span>
      </button>
      <button
        className="icon-btn player-queue-add"
        type="button"
        aria-label={`Add ${title} to the queue`}
        onClick={() => getPlayQueue().add(id)}
      >
        <Icon name="plus" />
      </button>
    </li>
  );
}

/** The item last shown as playing, kept across the view's mounts: a new one is what moves the list. */
let lastCurrent: string | null = null;

/**
 * The item playing now, first in the list (D346): what played before it is not listed, so a podcast
 * played from its page, or one tapped in the list, always heads Up next. It is swiped away like any
 * row; its handle only marks it, as it has nowhere to move to.
 */
function CurrentRow({ id }: { id: string }) {
  const meta = useQueueMeta(id);
  const title = meta?.title ?? longDateFromDigestId(id);
  const ref = useRef<HTMLLIElement>(null);
  // The list moves to the item that has just begun, so the list does not stay scrolled below it. Not
  // on opening the view: switching tabs keeps the page where it was (owner, 2026-11-02: Up next
  // jumped to the top).
  useEffect(() => {
    if (lastCurrent !== id && lastCurrent !== null) ref.current?.scrollIntoView({ block: "start" });
    lastCurrent = id;
  }, [id]);
  const swipe = useRowSwipe();
  return (
    <li
      className="player-queue-item"
      data-queue-id={id}
      data-state="current"
      aria-current="true"
      ref={ref}
      onPointerDown={(event) => swipe.onPointerDown(event, id)}
      onPointerMove={swipe.onPointerMove}
      onPointerUp={swipe.onPointerEnd}
      onPointerCancel={swipe.onPointerEnd}
    >
      <QueueDeleteMark />
      <div className="player-queue-face">
        <button
          className="player-queue-row"
          type="button"
          onClick={() => {
            if (!swipe.swiped()) playQueueItem(id);
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
        {/* The two bars stand in the playing row's place too, so its end lines up with the rows under
            it; the row that plays has nowhere to be moved to, so they only mark it (aria-hidden). */}
        <span className="icon-btn player-queue-grip" data-still aria-hidden="true">
          <Icon name="grip" />
        </span>
      </div>
    </li>
  );
}

/**
 * The player's Up next view: the queue, when the listener queued something, or else the suggested
 * items. The queue starts by itself when a recording ends (the listener chose it); with an empty
 * queue Autoplay starts the first suggested item, unless the listener turned it off. Where the
 * site's list cannot be read (offline), the previous briefing is offered instead, and never starts
 * by itself.
 */
export default function UpNext() {
  const { upNextId: previous } = usePlayerState();
  const { current, upcoming: queued } = useQueueView();
  const suggested = useSuggested(queued);
  const playingId = usePlayerState().track?.digest.id ?? null;
  // The playing item heads the list, whatever else is queued or suggested (D346).
  const passed =
    current && current === playingId ? (
      <ul className="player-queue-list" aria-label="Playing">
        <CurrentRow key={current} id={current} />
      </ul>
    ) : null;
  if (queued.length > 0)
    return (
      <>
        {passed}
        <QueueList ids={queued} />
      </>
    );
  if (suggested && suggested.length > 0) {
    return (
      <>
        {passed}
        <section aria-labelledby="player-suggested-head">
          <p className="player-upnext-hint player-suggested-head" id="player-suggested-head">
            Suggested
          </p>
          <ul className="player-queue-list">
            {suggested.map((id) => (
              <SuggestedRow key={id} id={id} />
            ))}
          </ul>
        </section>
      </>
    );
  }
  // A list that loaded but holds nothing eligible is empty; the previous briefing stands in only
  // where the list could not be read.
  // The playing row stays in every case; the empty line stands under it, or alone where nothing plays.
  if (suggested || !previous) {
    return (
      <>
        {passed}
        <p className="player-empty">Nothing is queued.</p>
      </>
    );
  }
  // The new page's data arrives after the navigation; the store plays it then, on the same audio
  // element, which the browser already trusts to play. A briefing with no finished audio is
  // narrated there, as a cover press does.
  return (
    <>
      {passed}
      <button className="player-upnext-row" type="button" onClick={() => playQueueItem(previous)}>
        <span className="player-upnext-text">
          <span className="player-upnext-date">{longDateFromDigestId(previous)}</span>
          <span className="player-upnext-hint">The previous podcast</span>
        </span>
        <Icon name="chevronRight" />
      </button>
    </>
  );
}
