import { formatClock } from "./core/formatTime";
import { getPlayerStore } from "./core/playerRuntime";
import { usePlayerState } from "./hooks/usePlayer";

/** One row per section: the name and its length. Tapping plays the section from its first item. */
export default function ChapterList() {
  const state = usePlayerState();
  const timeline = state.track?.timeline;
  if (!timeline || timeline.sections.length === 0) return null;
  const store = getPlayerStore();
  return (
    <section aria-labelledby="player-chapters-title">
      <h3 className="player-section-title" id="player-chapters-title">
        Chapters
      </h3>
      {/* biome-ignore lint/a11y/noRedundantRoles: Safari drops list semantics under list-style: none */}
      <ul className="chapter-rows" role="list">
        {timeline.sections.map((section, index) => {
          const current =
            state.hasStarted && state.status !== "idle" && index === state.sectionIndex;
          return (
            <li key={section.slug}>
              <button
                className="chapter-row press"
                type="button"
                aria-current={current ? "true" : undefined}
                aria-label={`Listen to ${section.title}, ${formatClock(section.endSec - section.startSec)}`}
                onClick={() => store.playItemAt(section.firstIndex)}
              >
                <span className="chapter-row-name">{section.title}</span>
                <span className="chapter-row-time num" aria-hidden="true">
                  {formatClock(section.endSec - section.startSec)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
