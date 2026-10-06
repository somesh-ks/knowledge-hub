import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Icon from "../player/ui/Icon";
import { dismissToast, getToast, subscribeToast, type ToastContent } from "./toastStore";

/**
 * The toast: a top-layer popover, centered above the mini player. Its text is announced through
 * the polite live region by whoever shows it; the toast itself never steals focus.
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
    if (!element) return;
    const open = element.matches(":popover-open");
    if (toast && !open) element.showPopover();
    else if (!toast && open) element.hidePopover();
  }, [toast]);

  return (
    <div ref={ref} className="toast" popover="manual">
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
      <button
        className="toast-dismiss press"
        type="button"
        aria-label="Dismiss"
        onClick={dismissToast}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}
