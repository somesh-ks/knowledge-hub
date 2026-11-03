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
 * An item that already played, or the one playing now (D277): the list keeps them, as a music app's
 * queue does, and a press plays one again. They are not moved or removed from here.
 */
function PassedRow({ id, state }: { id: string; state: "played" | "current" }) {
  const meta = useQueueMeta(id);
  const title = meta?.title ?? longDateFromDigestId(id);
  const ref = useRef<HTMLLIElement>(null);
  // The list moves to the item that has just begun, so the played ones above it do not push what is
  // next out of view. Not on opening the view: switching tabs keeps the page where it was (owner,
  // 2026-11-02: Up next jumped to the top).
  useEffect(() => {
    if (state !== "current") return;
    if (lastCurrent !== id && lastCurrent !== null) ref.current?.scrollIntoView({ block: "start" });
    lastCurrent = id;
  }, [state, id]);
  const swipe = useRowSwipe();
  return (
    <li
      className="player-queue-item"
      data-queue-id={id}
      data-state={state}
      aria-current={state === "current" ? "true" : undefined}
      ref={ref}
      onPointerDown={(event) => swipe.onPointerDown(event, id)}
      onPointerMove={swipe.onPointerMove}
      onPointerUp={swipe.onPointerEnd}
      onPointerCancel={swipe.onPointerEnd}
    >
      <QueueDeleteMark />
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
      {state === "current" ? (
        // The two bars stand in the playing row's place too, so its end lines up with the rows under
        // it; the row that plays has nowhere to be moved to, so they only mark it (aria-hidden).
        <span className="icon-btn player-queue-grip" data-still aria-hidden="true">
          <Icon name="grip" />
        </span>
      ) : null}
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
  const { played, current, upcoming: queued } = useQueueView();
  const suggested = useSuggested(queued);
  const playingId = usePlayerState().track?.digest.id ?? null;
  // What played stays listed behind the item playing now. Shown only once the listener has queued
  // or played through something, so a single play with nothing queued still reads "Nothing is queued".
  const passed =
    played.length > 0 || queued.length > 0 ? (
      <ul className="player-queue-list" aria-label="Played">
        {played.map((id) => (
          <PassedRow key={id} id={id} state="played" />
        ))}
        {current && current === playingId ? (
          <PassedRow key={current} id={current} state="current" />
        ) : null}
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
  // What played stays listed in every case (D277); the empty line only stands where nothing is.
  if (suggested || !previous) {
    return passed ?? <p className="player-empty">Nothing is queued.</p>;
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
