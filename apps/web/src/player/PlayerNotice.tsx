import { createPortal } from "react-dom";
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
 * The action leaves with the notice while a retry loads: focus moves to the Play disc first, which
 * stays, so a second Enter is not lost to the page.
 */
function keepFocus(): void {
  document.querySelector<HTMLElement>("[data-player-page] .transport [data-primary]")?.focus();
}

/**
 * The one place the player explains itself: a playback error, or a pause the system caused. A
 * status line is a `status` role; an error is an `alert`, so it is announced at once. A press on
 * Play in a refusal that stands sends nothing and reports the same reason as a new error: the
 * alert is put in again, so a screen reader says why again (the live region stays quiet while
 * the page is open).
 *
 * It is drawn in the room under the title that the story line and its source keep (PlayerSurface's
 * `data-notice-slot`), in their place, so a failure that comes or goes moves nothing below it.
 */
export default function PlayerNotice({ onRetry }: PlayerNoticeProps) {
  const state = usePlayerState();
  let notice: React.ReactNode = null;
  if (state.error) {
    // A missing file is not fixed by trying again; the Play disc still offers it, once.
    const action = noticeAction(state.error.kind);
    notice = (
      <div className="player-notice" data-tone="danger" role="alert" key={keyOf(state.error)}>
        <Icon name="alert" />
        <p>{state.error.message}</p>
        {action ? (
          <button
            className="player-notice-action"
            type="button"
            onClick={() => {
              keepFocus();
              onRetry();
            }}
          >
            {action}
          </button>
        ) : null}
      </div>
    );
  } else if (state.interrupted) {
    notice = (
      <div className="player-notice" data-tone="info" role="status">
        <Icon name="info" />
        <p>{INTERRUPTED_LINE}</p>
        <button
          className="player-notice-action"
          type="button"
          onClick={() => {
            keepFocus();
            getPlayerStore().play();
          }}
        >
          Resume
        </button>
      </div>
    );
  }
  const slot = notice ? document.querySelector("[data-player-page] [data-notice-slot]") : null;
  return slot ? createPortal(notice, slot) : notice;
}
