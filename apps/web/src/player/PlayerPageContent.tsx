import { useId, useMemo, useState } from "react";
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
const UP_NEXT_ONLY = LIST_VIEWS.filter((tab) => tab.value === "upnext");

/**
 * The player page's lazy half. Two groups, so a wide screen can set them side by side: the
 * controls that belong with the cover, and the list under two views. Stories merges the chapters
 * and the transcript: the story being read shows its transcript and every other story is a chapter
 * row that jumps to it. Up next is the play queue (D126), and the only view once a recording has
 * ended with something to offer.
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
  const offered = queued.length > 0 || Boolean(upNextId);
  // When a recording ends with something to offer, only Up next shows, as YouTube Music's player
  // does (D126): the queue starts by itself, and the previous briefing waits for a tap. The tab line
  // stays, holding one tab, so nothing below it moves and a focused Up next tab keeps its focus.
  // Playing again brings Stories back, on the view the listener last chose.
  const ended = status === "ended" && offered;
  const view = ended ? "upnext" : choice && choice.id === id ? choice.view : "stories";
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
        {/* On a phone the switch sticks under the status bar (player.css, .player-tabs-bar). */}
        <div className="player-tabs-bar">
          <PlayerTabs
            label="Show"
            idBase={idBase}
            tabs={ended ? UP_NEXT_ONLY : LIST_VIEWS}
            value={view}
            onChange={(next) => setChoice({ id, view: next })}
          />
        </div>
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
