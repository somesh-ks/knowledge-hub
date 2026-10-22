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

  // The deploy offer was queued once per return while the store had not loaded, then shown several
  // times over, and over a toast queued ahead of it.
  it("keeps one waiting toast per key, and asks again before it shows", () => {
    const page = new EventTarget();
    let up = false;
    const offer = { key: "deploy", unless: () => up };
    sendToast({ message: "Lost" }, page);
    sendToast({ message: "New 1" }, page, offer);
    sendToast({ message: "New 2" }, page, offer);
    const shown: string[] = [];
    page.addEventListener(TOAST_EVENT, (event) => {
      event.preventDefault();
      shown.push((event as CustomEvent<{ message: string }>).detail.message);
      up = true;
    });
    page.dispatchEvent(new Event(TOAST_READY));
    expect(shown).toEqual(["Lost"]);
  });
});
