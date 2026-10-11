import { getPlayerStore } from "./core/playerRuntime";
import { usePlayerState } from "./hooks/usePlayer";
import Clock from "./ui/Clock";

interface StoryDisplayItem {
  id: string;
  index: number;
  headline: string;
  section: string;
  durationSec: number | null;
}

interface StoryDisplaySection {
  slug: string;
  title: string;
}

/**
 * "Chapters": every story, under its section, with its length. Tapping one plays it from
 * its start. The story being read is marked by shape and weight as well as color.
 */
export default function StoryList({ titleHidden = false }: { titleHidden?: boolean }) {
  const state = usePlayerState();
  const timeline = state.track?.timeline;
  const digest = state.track?.digest;

  const items: StoryDisplayItem[] = timeline
    ? timeline.items.map((item) => ({
        id: item.id,
        index: item.index,
        headline: item.headline,
        section: item.section,
        durationSec: Math.max(0, item.endSec - item.startSec),
      }))
    : (digest?.items.map((item, index) => ({
        id: item.id,
        index,
        headline: item.headline,
        section: item.section,
        durationSec:
          item.start_ms !== null && item.end_ms !== null
            ? Math.max(0, (item.end_ms - item.start_ms) / 1000)
            : null,
      })) ?? []);

  if (items.length === 0) return null;

  const sections: StoryDisplaySection[] = timeline
    ? timeline.sections.map((section) => ({ slug: section.slug, title: section.title }))
    : digest?.sections && digest.sections.length > 0
      ? digest.sections.map((section) => ({ slug: section.slug, title: section.title }))
      : [{ slug: items[0]?.section ?? "stories", title: "Stories" }];

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
                  const current = live && item.index === state.itemIndex;
                  return (
                    <li key={item.id}>
                      <button
                        className="story-row"
                        type="button"
                        aria-current={current ? "true" : undefined}
                        onClick={() => {
                          if (timeline) {
                            store.playItemAt(item.index);
                          } else {
                            store.toggle();
                          }
                        }}
                      >
                        <span className="story-row-mark" aria-hidden="true" />
                        <span className="story-row-title">{item.headline}</span>
                        {item.durationSec !== null ? (
                          <span className="story-row-time">
                            <Clock seconds={item.durationSec} />
                          </span>
                        ) : null}
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
