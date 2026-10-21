import { useEffect, useId, useMemo, useState } from "react";
import { getPlayerStore } from "./core/playerRuntime";
import { storyTurns } from "./core/storyTurns";
import { usePlayerState } from "./hooks/usePlayer";
import { useQueue } from "./hooks/useQueue";
import PlayerNotice from "./PlayerNotice";
import Scrubber from "./Scrubber";
import StoryList from "./StoryList";
import TransportControls from "./TransportControls";
import UpNext from "./UpNext";
import PlayerTabs from "./ui/PlayerTabs";

type ListView = "stories" | "upnext";

const LIST_VIEWS = [
  { value: "stories", label: "Stories" },
  { value: "upnext", label: "Up next" },
] as const;

/**
 * The player page's lazy half. Two groups, so a wide screen can set them side by side: the
 * controls that belong with the cover, and the list under two views. Stories merges the chapters
 * and the transcript: the story being read shows its transcript and every other story is a chapter
 * row that jumps to it. Up next is the play queue (D126).
 */
export default function PlayerPageContent() {
  const { track, status, upNextId } = usePlayerState();
  const queued = useQueue();
  const digest = track?.digest;
  const turns = useMemo(() => digest?.turns ?? storyTurns(digest?.items ?? []), [digest]);
  const idBase = useId();
  const id = digest?.id;
  // A choice belongs to the recording it was made on, so the next one opens on Stories.
  const [choice, setChoice] = useState<{ id: string | undefined; view: ListView } | null>(null);
  const view = choice && choice.id === id ? choice.view : "stories";
  const offered = queued.length > 0 || Boolean(upNextId);
  // When a recording ends the view turns to what is next: the queue starts by itself, and the
  // previous briefing waits for a tap. The listener can turn back to Stories.
  useEffect(() => {
    if (status === "ended" && offered) setChoice({ id, view: "upnext" });
  }, [status, offered, id]);
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
        <PlayerTabs
          label="Show"
          idBase={idBase}
          tabs={LIST_VIEWS}
          value={view}
          onChange={(next) => setChoice({ id, view: next })}
        />
        <div
          className="player-panel"
          role="tabpanel"
          id={`${idBase}-panel-${view}`}
          aria-labelledby={`${idBase}-tab-${view}`}
        >
          {view === "upnext" ? <UpNext /> : <StoryList turns={turns} />}
        </div>
      </div>
    </>
  );
}
