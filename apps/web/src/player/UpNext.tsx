import { useEffect, useState } from "react";
import { longDateFromDigestId } from "./core/formatTime";
import { getPlayQueue, loadSuggested, playQueueItem } from "./core/playerRuntime";
import { usePlayerState } from "./hooks/usePlayer";
import { useQueue, useQueueMeta } from "./hooks/useQueue";
import QueueList from "./QueueList";
import Icon from "./ui/LazyIcon";
import PlayerCover from "./ui/PlayerCover";

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
        <Icon name="plus" className="icon" />
      </button>
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
  const queued = useQueue();
  const suggested = useSuggested(queued);
  if (queued.length > 0) return <QueueList ids={queued} />;
  if (suggested && suggested.length > 0) {
    return (
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
    );
  }
  // A list that loaded but holds nothing eligible is empty; the previous briefing stands in only
  // where the list could not be read.
  if (suggested || !previous) {
    return <p className="player-empty">Nothing is queued.</p>;
  }
  // The new page's data arrives after the navigation; the store plays it then, on the same audio
  // element, which the browser already trusts to play. A briefing with no finished audio is
  // narrated there, as a cover press does.
  return (
    <button className="player-upnext-row" type="button" onClick={() => playQueueItem(previous)}>
      <span className="player-upnext-text">
        <span className="player-upnext-date">{longDateFromDigestId(previous)}</span>
        <span className="player-upnext-hint">The previous briefing</span>
      </span>
      <Icon name="chevronRight" />
    </button>
  );
}
