import { useRef } from "react";
import { errorSummary, isPlayingStatus, toggleLabel } from "./core/playerCopy";
import { getPlayerStore } from "./core/playerRuntime";
import { playerSheet } from "./core/playerSheet";
import { fractionOfTime } from "./core/scrubberMath";
import { usePlayerFrame, usePlayerState } from "./hooks/usePlayer";
import Icon from "./ui/Icon";
import PlayerCover from "./ui/PlayerCover";
import PlayPauseGlyph from "./ui/PlayPauseGlyph";

/** The page the bar's open button controls. An element id, so it keeps the product's first name. */
export const PLAYER_PAGE_ID = "dispatch-player-page";

/**
 * The dock: the bar at the bottom of the screen, and the collapsed end of the player surface. A
 * tap or a pull up on its open button grows it into the page; its cover is where the flying cover
 * leaves from. On a wide screen it stays put and keeps working while the page is open above it.
 */
export default function PlayerBar() {
  const state = usePlayerState();
  const store = getPlayerStore();
  const fillRef = useRef<HTMLSpanElement>(null);

  // The playhead goes straight to a leaf element: React never renders at frame rate.
  usePlayerFrame((time, duration) => {
    fillRef.current?.style.setProperty(
      "--player-progress",
      fractionOfTime(time, duration).toFixed(5),
    );
  });

  const digest = state.track?.digest;
  const timeline = state.track?.timeline;
  const item = timeline?.items[state.itemIndex];
  const section = timeline?.sections[state.sectionIndex];
  const itemCount = timeline?.items.length ?? 0;
  const playing = isPlayingStatus(state.status);
  const headline = item?.headline ?? digest?.title ?? "";

  let caption =
    section && itemCount > 0
      ? `${section.title}, ${state.itemIndex + 1} of ${itemCount}`
      : (digest?.title ?? "");
  if (state.error) caption = errorSummary(state.error.kind);
  else if (state.interrupted) caption = "Interrupted, press play to resume";

  const isLastItem = itemCount === 0 || state.itemIndex >= itemCount - 1;

  return (
    <section className="player-dock" aria-label="Audio player" data-player-dock>
      <div className="dock-progress" aria-hidden="true">
        <span className="dock-progress-fill" ref={fillRef} />
      </div>
      <button
        className="dock-open press press-subtle"
        type="button"
        data-player-open
        aria-haspopup="dialog"
        // The surface controller keeps this in step with the page; false is the collapsed truth.
        aria-expanded="false"
        aria-controls={PLAYER_PAGE_ID}
        aria-label={`Open the player. ${headline}`}
        onClick={(event) =>
          playerSheet.click({ t: event.timeStamp, fromPointer: event.detail > 0 })
        }
      >
        <span className="player-thumb" data-player-thumb>
          {digest ? (
            <PlayerCover cover={digest.cover} weekly={digest.kind === "weekly"} size="thumb" />
          ) : null}
        </span>
        <span className="dock-text">
          <span className="dock-caption" data-tone={state.error ? "danger" : undefined}>
            {caption}
          </span>
          <span className="dock-title">{headline}</span>
        </span>
      </button>
      <button
        className="dock-btn press"
        type="button"
        data-primary
        data-playing={String(playing)}
        data-loading={String(state.buffering)}
        aria-label={toggleLabel(state)}
        aria-busy={state.buffering || undefined}
        onClick={() => store.toggle()}
      >
        <PlayPauseGlyph />
        <span className="spinner" aria-hidden="true" />
      </button>
      <button
        className="dock-btn press"
        type="button"
        aria-label="Next item"
        aria-disabled={isLastItem || undefined}
        onClick={() => {
          if (!isLastItem) store.next();
        }}
      >
        <Icon name="skipForward" />
      </button>
    </section>
  );
}
