import { useRef } from "react";
import { errorSummary, isPlayingStatus, toggleLabel } from "./core/playerCopy";
import { getPlayerStore } from "./core/playerRuntime";
import { playerSheet } from "./core/playerSheet";
import { fractionOfTime } from "./core/scrubberMath";
import { useOpenSwipe } from "./hooks/useOpenSwipe";
import { usePlayerFrame, usePlayerState } from "./hooks/usePlayer";
import Icon from "./ui/Icon";
import PlayerCover from "./ui/PlayerCover";
import PlayPauseGlyph from "./ui/PlayPauseGlyph";

/**
 * The mini player: a floating bar that appears after the first play and never hides again. Tap or
 * swipe up on the open button to expand it; the cover is the shared element of that morph.
 */
export default function PlayerBar() {
  const state = usePlayerState();
  const store = getPlayerStore();
  const openRef = useRef<HTMLButtonElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);

  // The playhead goes straight to a leaf element: React never renders at frame rate.
  usePlayerFrame((time, duration) => {
    fillRef.current?.style.setProperty(
      "--player-progress",
      fractionOfTime(time, duration).toFixed(5),
    );
  });
  useOpenSwipe(openRef);

  const track = state.track;
  if (!track) return null;

  const { timeline, digest } = track;
  const item = timeline?.items[state.itemIndex];
  const section = timeline?.sections[state.sectionIndex];
  const itemCount = timeline?.items.length ?? 0;
  const visible = state.hasStarted && Boolean(digest.audio);
  const playing = isPlayingStatus(state.status);
  const headline = item?.headline ?? digest.title;

  let caption =
    section && itemCount > 0
      ? `${section.title}, ${state.itemIndex + 1} of ${itemCount}`
      : digest.title;
  if (state.error) caption = errorSummary(state.error.kind);
  else if (state.interrupted) caption = "Interrupted, press play to resume";

  const isLastItem = itemCount === 0 || state.itemIndex >= itemCount - 1;

  return (
    <section
      className="mini"
      aria-label="Audio player"
      data-visible={visible ? "true" : "false"}
      data-player-bar
    >
      <div className="mini-progress" aria-hidden="true">
        <span className="mini-progress-fill" ref={fillRef} />
      </div>
      <button
        ref={openRef}
        className="mini-open press press-subtle"
        type="button"
        aria-haspopup="dialog"
        aria-label={`Open the player. ${headline}`}
        onClick={() => playerSheet.open()}
      >
        <PlayerCover cover={digest.cover} weekly={digest.kind === "weekly"} size="thumb" isMini />
        <span className="mini-text">
          <span className="mini-section" data-tone={state.error ? "danger" : undefined}>
            {caption}
          </span>
          <span className="mini-title">{headline}</span>
        </span>
      </button>
      <button
        className="mini-btn press"
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
        className="mini-btn press"
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
