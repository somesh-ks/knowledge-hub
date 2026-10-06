import { isPlayingStatus, toggleLabel } from "./core/playerCopy";
import { getPlayerStore } from "./core/playerRuntime";
import { usePlayerState } from "./hooks/usePlayer";
import Icon from "./ui/Icon";
import PlayPauseGlyph from "./ui/PlayPauseGlyph";

/** Five controls in a row, one dominant: item skip, 15-second skip, play and pause, and back. */
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
        className="transport-btn press"
        type="button"
        data-size="sm"
        aria-label="Back 15 seconds"
        onClick={() => store.skip(-15)}
      >
        <Icon name="back15" />
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
      <button
        className="transport-btn press"
        type="button"
        data-size="sm"
        aria-label="Forward 15 seconds"
        onClick={() => store.skip(15)}
      >
        <Icon name="forward15" />
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
