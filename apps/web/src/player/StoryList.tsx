import { useEffect, useRef, useState } from "react";
import type { PlayerTurn } from "../types/contracts";
import { getPlayerStore, playPageStory } from "./core/playerRuntime";
import { storyEntries } from "./core/storyEntries";
import { transcriptRange } from "./core/storyTranscript";
import { usePlayerState } from "./hooks/usePlayer";
import { useRovingFocus } from "./hooks/useRovingFocus";
import ScriptView from "./ScriptView";
import Clock from "./ui/Clock";

/**
 * "Stories": every story, under its section, with its length. Tapping one plays it from its start.
 * The story being read is open: its transcript sits under its row, with the spoken word lit, and
 * every other story stays a chapter row. Before story 1 (an episode's rundown) the rundown's
 * transcript sits above the rows. An episode whose narration is not laid out yet places its stories
 * by its script, and a tap starts it there. Stories with no place at all are listed as plain rows:
 * there is nothing a tap could play from.
 */
export default function StoryList({ turns }: { turns: readonly PlayerTurn[] }) {
  const state = usePlayerState();
  const timeline = state.track?.timeline;
  const digest = state.track?.digest;

  const { timed, items, sections } = storyEntries(timeline, digest);
  const rootRef = useRef<HTMLElement>(null);
  // "Back to now" is drawn over the whole list, not in the one story that holds the transcript.
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(rootRef.current), []);
  // Every row across the sections is one Tab stop (the story being read, or the one focused last);
  // the arrow keys, Home and End move between rows, and Enter plays the focused one.
  useRovingFocus(rootRef, "button.story-row", items.length > 0);

  const store = getPlayerStore();
  // Nothing is being read while the audio has failed: no story is marked as playing.
  const live = state.hasStarted && state.status !== "idle" && state.status !== "error";
  const shown = sections.filter((section) => items.some((item) => item.section === section.slug));
  // One section needs no heading of its own: the list's name already says what it is.
  const grouped = shown.length > 1;
  const reading = timed && live ? items.find((item) => item.index === state.itemIndex) : undefined;
  // Before story 1 no story is open, and the rundown's turns are the transcript. Until the narration
  // is laid out nothing places a story, so the script is read whole.
  const range =
    turns.length === 0
      ? null
      : !timed
        ? { from: 0, to: turns.length }
        : !live
          ? null
          : transcriptRange(turns, reading ? reading.id : state.itemIndex < 0 ? null : "");
  if (items.length === 0 && !range) return null;
  const script = (at: typeof range) =>
    at ? <ScriptView turns={turns} range={at} backHost={host} /> : null;
  return (
    <section className="story-list" ref={rootRef} aria-labelledby="player-stories-title">
      <h3 className="sr-only" id="player-stories-title">
        Stories
      </h3>
      <div className="list-scroll">
        {reading ? null : script(range)}
        {shown.map((section) => {
          const sectionItems = items.filter((item) => item.section === section.slug);
          return (
            <div key={section.slug} className="story-group">
              {grouped ? <h4 className="story-group-title">{section.title}</h4> : null}
              {/* biome-ignore lint/a11y/noRedundantRoles: Safari drops list semantics under list-style: none */}
              <ul className="story-rows" role="list">
                {sectionItems.map((item) => {
                  const current = item === reading;
                  const time =
                    item.durationSec !== null ? (
                      <span className="story-row-time">
                        <Clock seconds={item.durationSec} />
                      </span>
                    ) : null;
                  const placed = timed || (item.startSec !== null && digest !== undefined);
                  if (!placed) {
                    return (
                      <li key={item.id}>
                        <span className="story-row" data-static="">
                          <span className="story-row-title">{item.headline}</span>
                          {time}
                        </span>
                      </li>
                    );
                  }
                  return (
                    <li key={item.id} data-open={current ? "" : undefined}>
                      <button
                        className="story-row"
                        type="button"
                        aria-current={current ? "true" : undefined}
                        onClick={() => {
                          if (timed) store.playItemAt(item.index);
                          else if (digest) playPageStory(digest.id, item.id);
                        }}
                      >
                        <span className="story-row-title">{item.headline}</span>
                        {time}
                      </button>
                      {current ? script(range) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
