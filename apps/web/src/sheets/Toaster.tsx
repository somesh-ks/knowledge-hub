import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Icon from "../player/ui/Icon";
import { dismissToast, getToast, subscribeToast, type ToastContent } from "./toastStore";

/** A swipe past this share of the toast's width takes it away. */
const SWIPE_SHARE = 0.35;
/** So does a shorter, quicker one: pixels per millisecond over the whole swipe. */
const SWIPE_SPEED = 0.6;

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
      new CustomEvent("dispatch:sound", { detail: kind === "error" ? "failure" : "success" }),
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

  // A finger slides the toast sideways, as Material's snackbar goes: past a third of its width, or
  // quickly, it leaves and is dismissed (a dismissal, never an Undo); short of that it springs back.
  // Its buttons keep their presses, and a mouse never drags it.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let drag: { id: number; x: number; at: number; dx: number } | null = null;
    const onDown = (event: PointerEvent): void => {
      if (event.pointerType === "mouse" || (event.target as Element).closest("button")) return;
      drag = { id: event.pointerId, x: event.clientX, at: event.timeStamp, dx: 0 };
      element.setPointerCapture(event.pointerId);
      element.dataset.dragging = "";
    };
    const onMove = (event: PointerEvent): void => {
      if (!drag || event.pointerId !== drag.id) return;
      drag.dx = event.clientX - drag.x;
      element.style.translate = `${drag.dx}px 0`;
    };
    const onUp = (event: PointerEvent): void => {
      if (!drag || event.pointerId !== drag.id) return;
      const { dx, at } = drag;
      drag = null;
      delete element.dataset.dragging;
      const speed = Math.abs(dx) / Math.max(1, event.timeStamp - at);
      // Leaving, it keeps sliding the way it went while the popover's own exit fades it.
      if (Math.abs(dx) > element.offsetWidth * SWIPE_SHARE || speed > SWIPE_SPEED) {
        element.style.translate = `${Math.sign(dx) * element.offsetWidth * 1.5}px 0`;
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
          onClick={dismissToast}
        >
          <Icon name="close" />
        </button>
      ) : null}
    </div>
  );
}
