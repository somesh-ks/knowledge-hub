import { useMemo, useState } from "react";
import { getPlayerStore } from "./core/playerRuntime";
import { storyTurns } from "./core/storyTurns";
import { usePlayerState } from "./hooks/usePlayer";
import { useQueue } from "./hooks/useQueue";
import PlayerNotice from "./PlayerNotice";
import QueueSheet from "./QueueSheet";
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
 * controls that belong with the cover, and the list of what is in the recording. Stories and
 * Transcript are always the two views of it: an episode's transcript is its script, a briefing's is
 * what the host says of each story.
 */
export default function PlayerPageContent() {
  const { track, status, upNextId } = usePlayerState();
  const queued = useQueue();
  const digest = track?.digest;
  const turns = useMemo(() => digest?.turns ?? storyTurns(digest?.items ?? []), [digest]);
  const hasScript = turns.length > 0;
  const hasChapters = (track?.timeline?.items.length ?? 0) > 0 || (digest?.items.length ?? 0) > 0;
  // An episode opens on its transcript, a briefing on its stories. A choice belongs to the recording
  // it was made on, so the next one opens on its own first view, with no frame of the wrong one.
  const first: ListView = digest?.turns ? "transcript" : "chapters";
  const [choice, setChoice] = useState<{ id: string | undefined; view: ListView } | null>(null);
  const view = choice && choice.id === digest?.id ? choice.view : first;
  const tabs = hasScript || hasChapters;
  const showScript = view === "transcript";
  // Once the recording has ended only Up next shows, when there is something to offer.
  const ended = status === "ended" && (queued.length > 0 || Boolean(upNextId));
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
        {ended ? null : tabs ? (
          <SegmentedControl
            className="player-views"
            legend="Show"
            legendHidden
            variant="tabs"
            options={LIST_VIEWS}
            value={view}
            onChange={(next) => setChoice({ id: digest?.id, view: next })}
          />
        ) : null}
        {ended ? null : showScript ? (
          hasScript ? (
            <ScriptView turns={turns} titleHidden />
          ) : (
            <p className="player-empty">There is no transcript for this recording.</p>
          )
        ) : hasChapters ? (
          <StoryList titleHidden />
        ) : (
          <p className="player-empty">There are no stories in this recording.</p>
        )}
      </div>
      {/* While a recording plays, what is queued waits in a strip at the foot of the page. */}
      {status === "ended" || queued.length === 0 ? null : <QueueSheet ids={queued} />}
    </>
  );
}
