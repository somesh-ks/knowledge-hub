/**
 * A tap whose click never came (owner, 2026-11-03, Android Chrome: a tab, then the open player's Play,
 * "the tap isn't registered"). Chrome sends the pointer's down and up but no click for a tap that
 * lands soon after a flick, and the player's pull up is one. A control that waits for the click does
 * nothing. So a short touch tap on a control that gets no click is made into one, once, for every
 * control on the site. A click that does come first is left alone; one that comes late is dropped.
 */
const CLICKABLE =
  "a[href], button, summary, [role='button'], [role='tab'], [role='menuitem'], [role='switch']";
/** Drift past this is a drag or a scroll, not a tap (cardHold.ts reads a hold the same way). */
const SLOP_PX = 10;
/** Shorter than a hold (cardHold.ts HOLD_MS, 450), whose lift must not click. */
const MAX_TAP_MS = 350;
/** The browser's own click follows its lift in the same moment; this much later it is not coming. */
const WAIT_MS = 50;
/** A click this soon after the one made here is the browser's late echo of the same tap. */
const ECHO_MS = 500;

let installed = false;

export function installTapRecovery(): void {
  if (installed) return;
  installed = true;

  let press: { id: number; control: Element; x: number; y: number; at: number } | null = null;
  let waiting: {
    control: Element;
    x: number;
    y: number;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  let sent: { control: Element; at: number } | null = null;
  let sending = false;

  const send = (): void => {
    const tap = waiting;
    waiting = null;
    if (
      !tap?.control.isConnected ||
      tap.control.closest("[inert]") ||
      tap.control.matches(":disabled")
    )
      return;
    sent = { control: tap.control, at: performance.now() };
    sending = true;
    try {
      tap.control.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          composed: true,
          detail: 1,
          clientX: tap.x,
          clientY: tap.y,
        }),
      );
    } finally {
      sending = false;
    }
  };

  document.addEventListener(
    "pointerdown",
    (event) => {
      press = null;
      sent = null;
      if (event.pointerType === "mouse" || !event.isPrimary || event.button !== 0) return;
      const control = (event.target as Element | null)?.closest?.(CLICKABLE);
      if (control) {
        press = {
          id: event.pointerId,
          control,
          x: event.clientX,
          y: event.clientY,
          at: event.timeStamp,
        };
      }
    },
    { capture: true, passive: true },
  );
  document.addEventListener(
    "pointermove",
    (event) => {
      if (press?.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > SLOP_PX) press = null;
    },
    { capture: true, passive: true },
  );
  document.addEventListener(
    "pointercancel",
    (event) => {
      if (press?.id === event.pointerId) press = null;
    },
    { capture: true, passive: true },
  );
  document.addEventListener(
    "pointerup",
    (event) => {
      if (press?.id !== event.pointerId) return;
      const tap = press;
      press = null;
      if (event.timeStamp - tap.at > MAX_TAP_MS) return;
      // Lifted on the control it went down on, not dragged off it (a pointer keeps its capture).
      const under = document.elementFromPoint(event.clientX, event.clientY);
      if (under?.closest(CLICKABLE) !== tap.control) return;
      if (waiting) clearTimeout(waiting.timer);
      waiting = {
        control: tap.control,
        x: event.clientX,
        y: event.clientY,
        timer: setTimeout(send, WAIT_MS),
      };
    },
    { capture: true, passive: true },
  );
  document.addEventListener(
    "click",
    (event) => {
      // A key's click (no count) is no part of a tap.
      if (sending || event.detail === 0) return;
      if (waiting?.control.contains(event.target as Node)) {
        // The browser sent this tap's click itself.
        clearTimeout(waiting.timer);
        waiting = null;
        return;
      }
      if (sent && performance.now() - sent.at < ECHO_MS) {
        sent = null;
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    { capture: true },
  );
}
