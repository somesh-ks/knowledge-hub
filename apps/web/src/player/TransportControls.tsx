import { isPlayingStatus, toggleLabel } from "./core/playerCopy";
import { getPlayerStore } from "./core/playerRuntime";
import { SKIP_BACK_SECONDS, SKIP_FORWARD_SECONDS } from "./core/playerTypes";
import { usePlayerState } from "./hooks/usePlayer";
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
  const itemCount = state.track?.timeline?.items.length ?? 0;
  const atLastItem = itemCount === 0 || state.itemIndex >= itemCount - 1;
  const playing = isPlayingStatus(state.status);

  return (
    <div className="transport">
      <button
        className="transport-btn press"
        type="button"
        aria-label="Previous item"
        aria-disabled={itemCount === 0 || undefined}
        onClick={() => store.previous()}
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
        <PlayPauseGlyph />
        <span className="spinner" aria-hidden="true" />
      </button>
      <SpeedControl />
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
        aria-label="Next item"
        aria-disabled={atLastItem || undefined}
        onClick={() => {
          if (!atLastItem) store.next();
        }}
      >
        <Icon name="skipForward" />
      </button>
    </div>
  );
}
