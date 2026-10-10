import { getPlayerStore } from "./core/playerRuntime";
import { usePlayerState } from "./hooks/usePlayer";
import Icon from "./ui/Icon";

interface PlayerNoticeProps {
  onRetry: () => void;
}

/**
 * The one place the player explains itself: a playback error, or a pause the system caused. A
 * status line is a `status` role; an error is an `alert`, so it is announced at once.
 */
export default function PlayerNotice({ onRetry }: PlayerNoticeProps) {
  const state = usePlayerState();
  if (state.error) {
    const blocked = state.error.kind === "blocked";
    return (
      <div className="player-notice" data-tone="danger" role="alert">
        <Icon name="alert" />
        <p>{state.error.message}</p>
        <button className="player-notice-action" type="button" onClick={onRetry}>
          {blocked ? "Play" : "Try again"}
        </button>
      </div>
    );
  }
  if (state.interrupted) {
    return (
      <div className="player-notice" data-tone="info" role="status">
        <Icon name="info" />
        <p>Playback was interrupted. Press play when you are ready.</p>
        <button
          className="player-notice-action"
          type="button"
          onClick={() => getPlayerStore().play()}
        >
          Resume
        </button>
      </div>
    );
  }
  return null;
}
