import { useEffect, useRef, useSyncExternalStore } from "react";
import { getSpeedDefault } from "./core/speedDefaultRuntime";
import { rateLabel } from "./SpeedControl";

function subscribe(onChange: () => void): () => void {
  return getSpeedDefault().subscribe(onChange);
}

/**
 * "Make 1.5x your default speed?": the shared confirm dialog (episode-actions.css), asked once per
 * speed (core/speedDefault.ts). Not now, Escape and a press outside all decline.
 */
export default function SpeedOffer() {
  const rate = useSyncExternalStore(
    subscribe,
    () => getSpeedDefault().getPending(),
    () => null,
  );
  const ref = useRef<HTMLDialogElement>(null);
  const shown = useRef<number | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (rate !== null && !dialog.open) {
      shown.current = rate;
      dialog.showModal();
    } else if (rate === null && dialog.open) dialog.close();
  }, [rate]);

  const label = rateLabel(rate ?? shown.current ?? 1);
  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby="speed-offer-title"
      onClose={() => getSpeedDefault().dismiss()}
    >
      <div className="confirm-form">
        <h2 className="sheet-title" id="speed-offer-title">
          Make {label} your default speed?
        </h2>
        <div className="confirm-actions">
          <button className="btn" type="button" onClick={() => ref.current?.close()}>
            Not now
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => {
              getSpeedDefault().accept();
              ref.current?.close();
            }}
          >
            Make default
          </button>
        </div>
      </div>
    </dialog>
  );
}
