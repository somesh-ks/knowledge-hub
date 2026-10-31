import { useEffect, useRef, useSyncExternalStore } from "react";
import { buttonClass } from "../design-system/button";
import {
  dialogActionsClass,
  dialogBodyClass,
  dialogClass,
  dialogTitleClass,
} from "../design-system/dialog";
import { getSpeedDefault } from "./core/speedDefaultRuntime";
import { rateLabel } from "./SpeedControl";

function subscribe(onChange: () => void): () => void {
  return getSpeedDefault().subscribe(onChange);
}

/**
 * "Make 1.5x your default speed?": the shared confirm dialog (dialog.css), asked once per
 * speed (core/speedDefault.ts). Not now, Escape and a press outside all decline.
 */
export default function SpeedOffer() {
  const rate = useSyncExternalStore(
    subscribe,
    () => getSpeedDefault().getPending(),
    () => null,
  );
  const ref = useRef<HTMLDialogElement>(null);

  // Mounted only while an offer stands, so no second confirm dialog sits in the page for Delete's
  // `dialog[data-dialog]` lookup to find.
  useEffect(() => {
    if (rate !== null && ref.current && !ref.current.open) ref.current.showModal();
  }, [rate]);

  if (rate === null) return null;
  const label = rateLabel(rate);
  return (
    <dialog
      ref={ref}
      className={dialogClass()}
      data-dialog=""
      aria-labelledby="speed-offer-title"
      onClose={() => getSpeedDefault().dismiss()}
    >
      <div className={dialogBodyClass()}>
        <h2 className={dialogTitleClass()} id="speed-offer-title">
          Make {label} your default speed?
        </h2>
        <div className={dialogActionsClass()}>
          <button
            className={buttonClass("text")}
            type="button"
            onClick={() => ref.current?.close()}
          >
            Not now
          </button>
          <button
            className={buttonClass("text")}
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
