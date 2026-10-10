import { getPlayerStore } from "./core/playerRuntime";
import { usePlayerState } from "./hooks/usePlayer";
import Clock from "./ui/Clock";

/**
 * "Chapters": every story, under its section, with its length. Tapping one plays it from
 * its start. The story being read is marked by shape and weight as well as color.
 */
export default function StoryList({ titleHidden = false }: { titleHidden?: boolean }) {
  const state = usePlayerState();
  const timeline = state.track?.timeline;
  if (!timeline || timeline.items.length === 0) return null;
  const store = getPlayerStore();
  const live = state.hasStarted && state.status !== "idle";
  return (
    <section className="story-list" aria-labelledby="player-stories-title">
      <h3 className={titleHidden ? "sr-only" : "player-section-title"} id="player-stories-title">
        Chapters
      </h3>
      {timeline.sections.map((section) => (
        <div key={section.slug} className="story-group">
          <h4 className="story-group-title">{section.title}</h4>
          {/* biome-ignore lint/a11y/noRedundantRoles: Safari drops list semantics under list-style: none */}
          <ul className="story-rows" role="list">
            {timeline.items
              .filter((item) => item.section === section.slug)
              .map((item) => {
                const current = live && item.index === state.itemIndex;
                return (
                  <li key={item.id}>
                    <button
                      className="story-row press"
                      type="button"
                      aria-current={current ? "true" : undefined}
                      onClick={() => store.playItemAt(item.index)}
                    >
                      <span className="story-row-mark" aria-hidden="true" />
                      <span className="story-row-title">{item.headline}</span>
                      <span className="story-row-time">
                        <Clock seconds={item.endSec - item.startSec} />
                      </span>
                    </button>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </section>
  );
}
