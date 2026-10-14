import { useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { INTERRUPTED_LINE, noticeAction } from "./core/playerCopy";
import { getPlayerStore } from "./core/playerRuntime";
import { usePlayerState } from "./hooks/usePlayer";
import Icon from "./ui/LazyIcon";

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

/** A press on the page's Play disc in a failure waits for its answer: the next notice it brings. */
let answerPending = false;

/**
 * Called by the page's Play disc when it is pressed in a failure. Its answer (the same reason again,
 * or the failure a retry ran into) is drawn under the title, which a listener who scrolled down to
 * the transport can no longer see, so that answer is brought into view.
 */
export function awaitNoticeAnswer(): void {
  answerPending = true;
}

/**
 * Scrolls the page just far enough to show the notice's line, and only when that line is above the
 * page's view. A failure that arrives with no press scrolls nothing: the alert is announced, and the
 * disc already offers Try again.
 */
function bringIntoView(slot: Element): void {
  const page = slot.closest("[data-player-page]");
  if (!page || slot.getBoundingClientRect().top >= page.getBoundingClientRect().top) return;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  slot.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" });
}

/**
 * The action leaves with the notice while a retry loads: focus moves to the Play disc first, which
 * stays, so a second Enter is not lost to the page.
 */
function keepFocus(): void {
  // The page's disc, or the bar's where the page has none (a wide screen with a mouse).
  const discs = document.querySelectorAll<HTMLElement>(
    "[data-player-page] .transport [data-primary], [data-player-dock] [data-primary]",
  );
  for (const disc of discs) {
    if (disc.checkVisibility()) {
      disc.focus();
      return;
    }
  }
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
  const errorKey = state.error ? keyOf(state.error) : null;
  useLayoutEffect(() => {
    // Sound is the answer to a press that worked: nothing is left to show.
    if (state.status === "playing") answerPending = false;
  }, [state.status]);
  useLayoutEffect(() => {
    if (errorKey === null || !answerPending) return;
    answerPending = false;
    const slot = document.querySelector("[data-player-page] [data-notice-slot]");
    if (slot) bringIntoView(slot);
  }, [errorKey]);
  let notice: React.ReactNode = null;
  if (state.error) {
    // A missing file is not fixed by trying again; the Play disc still offers it, once.
    const action = noticeAction(state.error.kind);
    notice = (
      <div className="player-notice" data-tone="danger" role="alert" key={errorKey}>
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
