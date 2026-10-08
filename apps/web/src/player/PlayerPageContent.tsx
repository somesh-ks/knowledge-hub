import { getPlayerStore } from "./core/playerRuntime";
import PlayerNotice from "./PlayerNotice";
import Scrubber from "./Scrubber";
import SourceLink from "./SourceLink";
import SpeedControl from "./SpeedControl";
import StoryList from "./StoryList";
import TransportControls from "./TransportControls";
import UpNext from "./UpNext";

/**
 * The player page's lazy half. Two groups, so a wide screen can set them side by side: the
 * controls that belong with the cover, and the list of what is in the briefing. Under the
 * transport sits one quiet row: the speed, and where the story came from.
 */
export default function PlayerPageContent() {
  return (
    <>
      <div className="player-controls">
        <PlayerNotice onRetry={() => getPlayerStore().retry()} />
        <Scrubber />
        <TransportControls />
        <div className="player-utility">
          <SpeedControl />
          <SourceLink />
        </div>
      </div>
      <div className="player-list">
        <UpNext />
        <StoryList />
      </div>
    </>
  );
}
