import { getPlayerStore } from "./core/playerRuntime";
import PlayerNotice from "./PlayerNotice";
import Scrubber from "./Scrubber";
import SpeedControl from "./SpeedControl";
import StoryList from "./StoryList";
import TransportControls from "./TransportControls";
import UpNext from "./UpNext";

/**
 * The player page's lazy half. Two groups, so a wide screen can set them side by side: the
 * controls that belong with the cover, and the list of what is in the briefing. The speed sits at
 * the end of the transport row.
 */
export default function PlayerPageContent() {
  return (
    <>
      <div className="player-controls">
        <PlayerNotice onRetry={() => getPlayerStore().retry()} />
        <Scrubber />
        <div className="transport-row">
          <TransportControls />
          <SpeedControl />
        </div>
      </div>
      <div className="player-list">
        <UpNext />
        <StoryList />
      </div>
    </>
  );
}
