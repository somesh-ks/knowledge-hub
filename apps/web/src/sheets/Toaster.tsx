import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Icon from "../player/ui/Icon";
import { dismissToast, getToast, subscribeToast, type ToastContent } from "./toastStore";

/**
 * The toast: a top-layer popover on the inverse surface, centered above the navigation bar and the
 * docked player. Its text is announced through the polite live region by whoever shows it; the toast
 * itself never steals focus.
 */
export default function Toaster() {
  const toast = useSyncExternalStore(subscribeToast, getToast, () => null);
  // The content outlives the toast for the length of its exit transition.
  const [shown, setShown] = useState<ToastContent | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (toast) setShown(toast);
  }, [toast]);

  useEffect(() => {
    const element = ref.current;
    // Safari before 17 has no Popover API, and asking it about :popover-open throws. There the
    // toast is not shown; its text still reaches a screen reader through the live region.
    if (!element || typeof element.showPopover !== "function") return;
    const open = element.matches(":popover-open");
    if (toast && !open) element.showPopover();
    else if (!toast && open) element.hidePopover();
  }, [toast]);

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
          className="toast-action press"
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
