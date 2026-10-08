import { longDateFromDigestId } from "./core/formatTime";
import { digestUrl, navigateTo } from "./core/navigation";
import { getPlayerStore } from "./core/playerRuntime";
import { playerSheet } from "./core/playerSheet";
import { usePlayerState } from "./hooks/usePlayer";
import Icon from "./ui/LazyIcon";

/**
 * After the last item the player offers the previous briefing. It never autoplays a chain: the
 * listener decides, and the choice is one tap.
 */
export default function UpNext() {
  const state = usePlayerState();
  const nextId = state.upNextId;
  if (state.status !== "ended" || !nextId) return null;

  function playUpNext(id: string): void {
    // The new page's data arrives after the navigation; the store plays it then, on the same
    // audio element, which the browser already trusts to play.
    getPlayerStore().playWhenPageLoads(id);
    // The page goes down first, so the new briefing arrives under the bar and not behind a modal.
    void playerSheet.collapse().then(() => navigateTo(digestUrl(id), { direction: "back" }));
  }

  return (
    <section className="player-upnext" aria-labelledby="player-upnext-title">
      <h3 className="player-section-title" id="player-upnext-title">
        Up next
      </h3>
      <button className="player-upnext-row press" type="button" onClick={() => playUpNext(nextId)}>
        <span className="player-upnext-text">
          <span className="player-upnext-date">{longDateFromDigestId(nextId)}</span>
          <span className="player-upnext-hint">The previous briefing</span>
        </span>
        <Icon name="chevronRight" />
      </button>
    </section>
  );
}
