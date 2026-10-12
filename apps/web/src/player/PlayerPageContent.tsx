import { useEffect, useState } from "react";
import { getPlayerStore } from "./core/playerRuntime";
import { usePlayerState } from "./hooks/usePlayer";
import PlayerNotice from "./PlayerNotice";
import ScriptView from "./ScriptView";
import Scrubber from "./Scrubber";
import StoryList from "./StoryList";
import TransportControls from "./TransportControls";
import UpNext from "./UpNext";
import SegmentedControl from "./ui/SegmentedControl";

type ListView = "chapters" | "transcript";

const LIST_VIEWS = [
  { value: "chapters", label: "Stories" },
  { value: "transcript", label: "Transcript" },
] as const;

/**
 * The player page's lazy half. Two groups, so a wide screen can set them side by side: the
 * controls that belong with the cover, and the list of what is in the briefing: its chapters, or
 * an episode's transcript, with a switch between them when there are both.
 */
export default function PlayerPageContent() {
  const track = usePlayerState().track;
  const hasScript = (track?.digest.turns?.length ?? 0) > 0;
  const hasChapters =
    (track?.timeline?.items.length ?? 0) > 0 || (track?.digest.items.length ?? 0) > 0;
  // An episode opens on its transcript; a briefing has only chapters.
  const [view, setView] = useState<ListView>("transcript");
  // Every episode opens on its transcript: a choice made on one does not carry to the next.
  const digestId = track?.digest.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: it runs when the recording changes
  useEffect(() => setView("transcript"), [digestId]);
  const both = hasScript && hasChapters;
  const showScript = hasScript && (!both || view === "transcript");
  return (
    <>
      <div className="player-controls">
        <Scrubber />
        <TransportControls />
        {/* Drawn under the title, in the story line's room (see PlayerNotice), so a notice
            arriving never moves the timeline or play. */}
        <PlayerNotice onRetry={() => getPlayerStore().retry()} />
      </div>
      <div className="player-list">
        <UpNext />
        {both ? (
          <SegmentedControl
            className="player-views"
            legend="Show"
            legendHidden
            variant="tabs"
            options={LIST_VIEWS}
            value={view}
            onChange={setView}
          />
        ) : null}
        {showScript ? <ScriptView titleHidden={both} /> : <StoryList titleHidden={both} />}
      </div>
    </>
  );
}
