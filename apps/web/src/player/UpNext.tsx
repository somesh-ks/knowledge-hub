import { longDateFromDigestId } from "./core/formatTime";
import { playQueueItem } from "./core/playerRuntime";
import { usePlayerState } from "./hooks/usePlayer";
import { useQueue } from "./hooks/useQueue";
import QueueList from "./QueueList";
import Icon from "./ui/LazyIcon";

/**
 * The player's Up next view: the queue, when the listener queued something, or else the previous
 * briefing. The queue starts by itself when a recording ends (the listener chose it); the previous
 * briefing never does: the listener decides, and the choice is one tap.
 */
export default function UpNext() {
  const { upNextId: previous } = usePlayerState();
  const queued = useQueue();
  if (queued.length > 0) return <QueueList ids={queued} />;
  if (!previous) {
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
