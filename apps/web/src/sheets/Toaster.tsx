import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { swipeLeaves } from "../lib/swipeAway";
import { createVelocityTracker, TAP_SLOP_PX } from "../player/core/gestureMath";
import Icon from "../player/ui/Icon";
import { dismissToast, getToast, subscribeToast, type ToastContent } from "./toastStore";

/**
 * The toast: a top-layer popover on the inverse surface, centered above the navigation bar and the
 * docked player. Its role speaks its message (status, or alert for an error), so whoever shows a
 * toast does not announce it again; the toast itself never steals focus.
 */
export default function Toaster() {
  const toast = useSyncExternalStore(subscribeToast, getToast, () => null);
  // The content outlives the toast for the length of its exit transition.
  const [shown, setShown] = useState<ToastContent | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (toast) setShown(toast);
  }, [toast]);

  // A toast that states an outcome sounds it (scripts/uiSound.ts); a plain message stays quiet.
  const id = toast?.id;
  const kind = toast?.kind;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the id re-sounds an identical message
  useEffect(() => {
    if (!kind) return;
    document.dispatchEvent(
      new CustomEvent("singularity:sound", { detail: kind === "error" ? "failure" : "success" }),
    );
  }, [id, kind]);

  useEffect(() => {
    const element = ref.current;
    // Safari before 17 has no Popover API, and asking it about :popover-open throws. There the
    // toast is not shown; its text still reaches a screen reader through the live region.
    if (!element || typeof element.showPopover !== "function") return;
    // A toast that was swiped away left its slide behind; the next one starts in place.
    if (toast) element.style.translate = "";
    const open = element.matches(":popover-open");
    if (toast && !open) element.showPopover();
    else if (!toast && open) element.hidePopover();
  }, [toast]);

  // A finger slides the toast sideways, as Material's snackbar goes: once it has moved past the tap
  // slop sideways it is a swipe, and on release it leaves when the shared rule says so
  // (lib/swipeAway.ts: a share of the width, or speed over the last 100 ms, never under twice the
  // slop) or springs back. Its buttons keep their presses, and a mouse never drags it.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const tracker = createVelocityTracker();
    let press: { id: number; x: number; y: number; swiping: boolean; dx: number } | null = null;
    const onDown = (event: PointerEvent): void => {
      if (event.pointerType === "mouse" || (event.target as Element).closest("button")) return;
      press = { id: event.pointerId, x: event.clientX, y: event.clientY, swiping: false, dx: 0 };
      tracker.reset({ value: event.clientX, t: event.timeStamp });
    };
    const onMove = (event: PointerEvent): void => {
      if (!press || event.pointerId !== press.id) return;
      const dx = event.clientX - press.x;
      const dy = event.clientY - press.y;
      tracker.push(event.clientX, event.timeStamp);
      if (!press.swiping) {
        if (Math.abs(dx) < TAP_SLOP_PX || Math.abs(dx) <= Math.abs(dy)) return;
        press.swiping = true;
        element.setPointerCapture(event.pointerId);
        element.dataset.dragging = "";
      }
      press.dx = dx;
      element.style.translate = `${dx}px 0`;
    };
    const onUp = (event: PointerEvent): void => {
      if (!press || event.pointerId !== press.id) return;
      const { swiping, dx } = press;
      press = null;
      if (!swiping) return;
      delete element.dataset.dragging;
      // Leaving, it keeps sliding the way it went while the popover's own exit fades it.
      if (swipeLeaves(dx, element.offsetWidth, tracker.velocity())) {
        element.style.translate = `${Math.sign(dx) * element.offsetWidth * 1.5}px 0`;
        getToast()?.onDismiss?.();
        dismissToast();
      } else element.style.translate = "";
    };
    element.addEventListener("pointerdown", onDown);
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerup", onUp);
    element.addEventListener("pointercancel", onUp);
    return () => {
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerup", onUp);
      element.removeEventListener("pointercancel", onUp);
    };
  }, []);

  return (
    <div
      ref={ref}
      className="toast"
      popover="manual"
      role={shown?.kind === "error" ? "alert" : "status"}
      data-one-line={shown?.oneLine ? "" : undefined}
    >
      {shown?.kind ? (
        <Icon className="toast-icon" name={shown.kind === "error" ? "alert" : "check"} />
      ) : null}
      <span className="toast-text">{shown?.message}</span>
      {shown?.actionLabel ? (
        <button
          className="toast-action"
          type="button"
          onClick={() => {
            dismissToast();
            shown.onAction?.();
          }}
        >
          {shown.actionLabel}
        </button>
      ) : null}
      {shown?.actionLabel ? (
        <button
          className="toast-dismiss press"
          type="button"
          aria-label="Dismiss"
          onClick={() => {
            shown.onDismiss?.();
            dismissToast();
          }}
        >
          <Icon name="close" />
        </button>
      ) : null}
    </div>
  );
}
