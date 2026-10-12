import { useRef } from "react";
import { getPlayerStore, playPageStory } from "./core/playerRuntime";
import { storyEntries } from "./core/storyEntries";
import { usePlayerState } from "./hooks/usePlayer";
import { useRovingFocus } from "./hooks/useRovingFocus";
import Clock from "./ui/Clock";

/**
 * "Stories": every story, under its section, with its length. Tapping one plays it from
 * its start. The story being read sits on the accent container. An episode whose
 * narration is not laid out yet places its stories by its script, and a tap starts it there.
 * Stories with no place at all are listed as plain rows: there is nothing a tap could play from.
 */
export default function StoryList({ titleHidden = false }: { titleHidden?: boolean }) {
  const state = usePlayerState();
  const timeline = state.track?.timeline;
  const digest = state.track?.digest;

  const { timed, items, sections } = storyEntries(timeline, digest);
  const rootRef = useRef<HTMLElement>(null);
  // Every row across the sections is one Tab stop (the story being read, or the one focused last);
  // the arrow keys, Home and End move between rows, and Enter plays the focused one.
  useRovingFocus(rootRef, "button.story-row", items.length > 0);
  if (items.length === 0) return null;

  const store = getPlayerStore();
  // Nothing is being read while the audio has failed: no story is marked as playing.
  const live = state.hasStarted && state.status !== "idle" && state.status !== "error";
  const shown = sections.filter((section) => items.some((item) => item.section === section.slug));
  // One section needs no heading of its own: the list's name already says what it is.
  const grouped = shown.length > 1;
  return (
    <section className="story-list" ref={rootRef} aria-labelledby="player-stories-title">
      <h3 className={titleHidden ? "sr-only" : "player-section-title"} id="player-stories-title">
        Stories
      </h3>
      <div className="list-scroll">
        {shown.map((section) => {
          const sectionItems = items.filter((item) => item.section === section.slug);
          return (
            <div key={section.slug} className="story-group">
              {grouped ? <h4 className="story-group-title">{section.title}</h4> : null}
              {/* biome-ignore lint/a11y/noRedundantRoles: Safari drops list semantics under list-style: none */}
              <ul className="story-rows" role="list">
                {sectionItems.map((item) => {
                  const current = timed && live && item.index === state.itemIndex;
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
                    <li key={item.id}>
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
