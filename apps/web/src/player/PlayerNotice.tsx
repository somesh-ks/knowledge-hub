import { INTERRUPTED_LINE, noticeAction } from "./core/playerCopy";
import { getPlayerStore } from "./core/playerRuntime";
import { usePlayerState } from "./hooks/usePlayer";
import Icon from "./ui/Icon";

interface PlayerNoticeProps {
  onRetry: () => void;
}

/** One key per error the store reports, so a reason said again is a new alert. */
const errorKeys = new WeakMap<object, number>();
let errorsSeen = 0;

function keyOf(error: object): number {
  let key = errorKeys.get(error);
  if (key === undefined) {
    errorsSeen += 1;
    key = errorsSeen;
    errorKeys.set(error, key);
  }
  return key;
}

/**
 * The one place the player explains itself: a playback error, or a pause the system caused. A
 * status line is a `status` role; an error is an `alert`, so it is announced at once. A press on
 * Play in a refusal that stands sends nothing and reports the same reason as a new error: the
 * alert is put in again, so a screen reader says why again (the live region stays quiet while
 * the page is open).
 */
export default function PlayerNotice({ onRetry }: PlayerNoticeProps) {
  const state = usePlayerState();
  if (state.error) {
    // A missing file is not fixed by trying again; the Play disc still offers it, once.
    const action = noticeAction(state.error.kind);
    return (
      <div className="player-notice" data-tone="danger" role="alert" key={keyOf(state.error)}>
        <Icon name="alert" />
        <p>{state.error.message}</p>
        {action ? (
          <button className="player-notice-action" type="button" onClick={onRetry}>
            {action}
          </button>
        ) : null}
      </div>
    );
  }
  if (state.interrupted) {
    return (
      <div className="player-notice" data-tone="info" role="status">
        <Icon name="info" />
        <p>{INTERRUPTED_LINE}</p>
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
