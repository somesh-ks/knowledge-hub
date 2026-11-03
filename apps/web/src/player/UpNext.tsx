import { useEffect, useState } from "react";
import { longDateFromDigestId } from "./core/formatTime";
import { getPlayQueue, loadSuggested, playQueueItem } from "./core/playerRuntime";
import { usePlayerState } from "./hooks/usePlayer";
import { useQueueMeta, useQueueView } from "./hooks/useQueue";
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
        <Icon name="plus" />
      </button>
    </li>
  );
}

/**
 * What Autoplay would play after the queue, under it always (owner, 2026-11-03: adding one made the
 * section vanish). A suggestion just queued leaves it at once, and the list is read again to fill
 * the place it left.
 */
function SuggestedSection({ ids, queued }: { ids: readonly string[]; queued: readonly string[] }) {
  const shown = ids.filter((id) => !queued.includes(id));
  if (shown.length === 0) return null;
  return (
    <section aria-labelledby="player-suggested-head">
      <p className="player-upnext-hint player-suggested-head" id="player-suggested-head">
        Suggested
      </p>
      <ul className="player-queue-list">
        {shown.map((id) => (
          <SuggestedRow key={id} id={id} />
        ))}
      </ul>
    </section>
  );
}

/**
 * The player's Up next view: the queue, when the listener queued something, and the suggested items
 * under it, always. The queue starts by itself when a recording ends (the listener chose it); with an empty
 * queue Autoplay starts the first suggested item, unless the listener turned it off. Where the
 * site's list cannot be read (offline), the previous briefing is offered instead, and never starts
 * by itself.
 */
export default function UpNext() {
  const { upNextId: previous } = usePlayerState();
  const { current, upcoming: queued } = useQueueView();
  const suggested = useSuggested(queued);
  const playingId = usePlayerState().track?.digest.id ?? null;
  // The playing item heads the list, whatever else is queued or suggested (D346), and moves with
  // the rows under it (D349).
  const lead = current && current === playingId ? current : null;
  const passed = lead ? <QueueList ids={[]} lead={lead} /> : null;
  if (queued.length > 0)
    return (
      <>
        <QueueList ids={queued} lead={lead} />
        {suggested ? <SuggestedSection ids={suggested} queued={queued} /> : null}
      </>
    );
  if (suggested && suggested.length > 0) {
    return (
      <>
        {passed}
        <SuggestedSection ids={suggested} queued={queued} />
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
