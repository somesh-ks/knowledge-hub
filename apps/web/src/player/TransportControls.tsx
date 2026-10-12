import { isPlayingStatus, toggleLabel } from "./core/playerCopy";
import { getPlayerStore } from "./core/playerRuntime";
import { SKIP_BACK_SECONDS, SKIP_FORWARD_SECONDS } from "./core/playerTypes";
import { usePlayerState } from "./hooks/usePlayer";
import { useStoryStep } from "./hooks/useStoryStep";
import SpeedControl from "./SpeedControl";
import Icon from "./ui/LazyIcon";
import PlayPauseGlyph from "./ui/PlayPauseGlyph";

/**
 * The transport, one control dominant: the previous story, back ten seconds, play and pause,
 * forward ten seconds, the next story, with the speed under play on a phone. On a wide screen with
 * a mouse the bar has previous, play and next, so the page shows the two skips with the speed
 * between them. The skip glyphs are plain circular arrows; each button
 * draws its own numeral in the arrow's open center, and the name stays on the button.
 */
export default function TransportControls() {
  const state = usePlayerState();
  const store = getPlayerStore();
  const step = useStoryStep();
  const playing = isPlayingStatus(state.status);

  return (
    <div className="transport">
      <button
        className="transport-btn press"
        type="button"
        aria-label="Previous story"
        aria-disabled={step.previousDisabled || undefined}
        onClick={step.previous}
      >
        <Icon name="skipBack" />
      </button>
      <button
        className="transport-btn transport-skip press"
        type="button"
        aria-label={`Back ${SKIP_BACK_SECONDS} seconds`}
        onClick={() => store.skip(-SKIP_BACK_SECONDS)}
      >
        <Icon name="replay10" />
        <span className="transport-skip-num num" aria-hidden="true">
          {SKIP_BACK_SECONDS}
        </span>
      </button>
      <button
        className="transport-btn press"
        type="button"
        data-primary
        data-playing={String(playing)}
        data-loading={String(state.buffering)}
        aria-label={toggleLabel(state)}
        aria-busy={state.buffering || undefined}
        onClick={() => store.toggle()}
      >
        <PlayPauseGlyph status={state.status} />
        <span className="spinner" aria-hidden="true" />
      </button>
      <button
        className="transport-btn transport-skip press"
        type="button"
        aria-label={`Forward ${SKIP_FORWARD_SECONDS} seconds`}
        onClick={() => store.skip(SKIP_FORWARD_SECONDS)}
      >
        <Icon name="forward10" />
        <span className="transport-skip-num num" aria-hidden="true">
          {SKIP_FORWARD_SECONDS}
        </span>
      </button>
      <button
        className="transport-btn press"
        type="button"
        aria-label="Next story"
        aria-disabled={step.nextDisabled || undefined}
        onClick={step.next}
      >
        <Icon name="skipForward" />
      </button>
      {/* Last in the DOM so Tab reaches it after Next; the grid places it under Play on a phone
          and after Forward ten on a wide screen. */}
      <SpeedControl />
    </div>
  );
}
