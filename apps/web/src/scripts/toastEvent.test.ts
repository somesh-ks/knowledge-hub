import { describe, expect, it } from "vitest";
import { sendToast, TOAST_EVENT, TOAST_READY } from "./toastEvent";

describe("sendToast", () => {
  // A toast sent before the sheets (and the toast's store) had loaded was dispatched to no one and lost.
  it("holds a toast sent before the store listens until the store is ready, then sends it once", () => {
    const page = new EventTarget();
    sendToast({ message: "Saved" }, page);
    const shown: unknown[] = [];
    page.addEventListener(TOAST_EVENT, (event) => {
      event.preventDefault();
      shown.push((event as CustomEvent).detail);
    });
    page.dispatchEvent(new Event(TOAST_READY));
    page.dispatchEvent(new Event(TOAST_READY));
    sendToast({ message: "Again" }, page);
    expect(shown).toEqual([{ message: "Saved" }, { message: "Again" }]);
  });
});
