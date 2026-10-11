import { getPlayerStore } from "./core/playerRuntime";
import { storyEntries } from "./core/storyEntries";
import { usePlayerState } from "./hooks/usePlayer";
import Clock from "./ui/Clock";

/**
 * "Chapters": every story, under its section, with its length. Tapping one plays it from
 * its start. The story being read is marked by shape and weight as well as color. Stories with no
 * place in the audio yet are listed as plain rows: there is nothing a tap could play from.
 */
export default function StoryList({ titleHidden = false }: { titleHidden?: boolean }) {
  const state = usePlayerState();
  const timeline = state.track?.timeline;
  const digest = state.track?.digest;

  const { timed, items, sections } = storyEntries(timeline, digest);
  if (items.length === 0) return null;

  const store = getPlayerStore();
  const live = state.hasStarted && state.status !== "idle";
  return (
    <section className="story-list" aria-labelledby="player-stories-title">
      <h3 className={titleHidden ? "sr-only" : "player-section-title"} id="player-stories-title">
        Chapters
      </h3>
      <div className="list-scroll">
        {sections.map((section) => {
          const sectionItems = items.filter((item) => item.section === section.slug);
          if (sectionItems.length === 0) return null;
          return (
            <div key={section.slug} className="story-group">
              <h4 className="story-group-title">{section.title}</h4>
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
                  if (!timed) {
                    return (
                      <li key={item.id}>
                        <span className="story-row" data-static="">
                          <span className="story-row-mark" aria-hidden="true" />
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
                        onClick={() => store.playItemAt(item.index)}
                      >
                        <span className="story-row-mark" aria-hidden="true" />
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
