import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { longDateFromDigestId } from "./core/formatTime";
import { getPlayQueue, loadSuggested, playQueueItem } from "./core/playerRuntime";
import { usePlayerState } from "./hooks/usePlayer";
import { useQueueMeta, useQueueView } from "./hooks/useQueue";
import QueueList from "./QueueList";
import { capture, play } from "./queueFlip";
import Icon from "./ui/LazyIcon";
import PlayerCover from "./ui/PlayerCover";

/**
 * The suggested items after what is playing, the list Autoplay draws from (core/suggested.ts).
 * Null until the site's list has been read; read again when the playing item changes.
 */
function useSuggested(queued: readonly string[], beforeChange: () => void): string[] | null {
  const currentId = usePlayerState().track?.digest.id ?? null;
  const [ids, setIds] = useState<string[] | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the list is read again for each item and queue change
  useEffect(() => {
    let live = true;
    void loadSuggested().then((loaded) => {
      if (!live) return;
      // The refill fades in, and the rows it pushes glide (queueFlip.ts).
      beforeChange();
      setIds(loaded);
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
const panelOf = (layer: HTMLElement | null): HTMLElement | null => layer?.parentElement ?? null;

export default function UpNext() {
  const { upNextId: previous } = usePlayerState();
  const { current, upcoming: queued, above } = useQueueView();
  /** An empty layer over the list for the rows that leave it (queueFlip.ts); its parent is the panel. */
  const ghosts = useRef<HTMLDivElement>(null);
  const suggested = useSuggested(queued, () => capture(panelOf(ghosts.current)));
  // Every change glides the list from where it stood (queueFlip.ts): the places are read as the
  // queue changes, before the list redraws, and played once it has.
  useLayoutEffect(() => getPlayQueue().subscribe(() => capture(panelOf(ghosts.current))), []);
  useLayoutEffect(() => play(panelOf(ghosts.current), ghosts.current));
  const playingId = usePlayerState().track?.digest.id ?? null;
  // The playing item heads the list unless the listener put rows above it (D346, D357), and moves
  // with the rows around it (D349).
  const lead = current && current === playingId ? current : null;
  const listed = [...above, ...queued];
  const rows =
    lead || listed.length > 0 ? <QueueList above={above} ids={queued} lead={lead} /> : null;
  const layer = <div className="player-queue-ghosts" aria-hidden="true" ref={ghosts} />;
  if (listed.length > 0 || (suggested && suggested.length > 0))
    return (
      <>
        {layer}
        {rows}
        {suggested ? <SuggestedSection ids={suggested} queued={listed} /> : null}
      </>
    );
  // A list that loaded but holds nothing eligible is empty; the previous briefing stands in only
  // where the list could not be read.
  // The playing row stays in every case; the empty line stands under it, or alone where nothing plays.
  if (suggested || !previous) {
    return (
      <>
        {layer}
        {rows}
        <p className="player-empty">Nothing is queued.</p>
      </>
    );
  }
  // The new page's data arrives after the navigation; the store plays it then, on the same audio
  // element, which the browser already trusts to play. A briefing with no finished audio is
  // narrated there, as a cover press does.
  return (
    <>
      {layer}
      {rows}
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
