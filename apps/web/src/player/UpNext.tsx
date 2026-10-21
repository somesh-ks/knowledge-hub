import { longDateFromDigestId } from "./core/formatTime";
import { playQueueItem } from "./core/playerRuntime";
import { usePlayerState } from "./hooks/usePlayer";
import { useQueue } from "./hooks/useQueue";
import QueueList from "./QueueList";
import Icon from "./ui/LazyIcon";

/**
 * What the open player shows once a recording has ended, in place of Stories and Transcript: the
 * queue, when the listener queued something, or else the previous briefing. The queue starts by
 * itself (the listener chose it); the previous briefing never does: the listener decides, and the
 * choice is one tap.
 */
export default function UpNext() {
  const state = usePlayerState();
  const queued = useQueue();
  if (state.status !== "ended") return null;
  const previous = state.upNextId;
  if (queued.length === 0 && !previous) return null;

  return (
    <section className="player-upnext" aria-labelledby="player-upnext-title">
      <h3 className="player-section-title" id="player-upnext-title">
        Up next
      </h3>
      {queued.length > 0 ? (
        <QueueList ids={queued} />
      ) : previous ? (
        // The new page's data arrives after the navigation; the store plays it then, on the same
        // audio element, which the browser already trusts to play. A briefing with no finished
        // audio is narrated there, as a cover press does.
        <button className="player-upnext-row" type="button" onClick={() => playQueueItem(previous)}>
          <span className="player-upnext-text">
            <span className="player-upnext-date">{longDateFromDigestId(previous)}</span>
            <span className="player-upnext-hint">The previous briefing</span>
          </span>
          <Icon name="chevronRight" />
        </button>
      ) : null}
    </section>
  );
}
