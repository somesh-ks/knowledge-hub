/**
 * The app's toast, asked for by event from code that must not import its store
 * (sheets/toastStore.ts): the import would split the store out of the sheets' chunk, a cost on
 * every page's first load. The store loads with the sheets at idle and takes the event by
 * cancelling it; one sent before it has loaded waits for the store's ready signal, so it is never
 * lost. A detail is a toast's content, or `{ dismiss: message }` to take that one away.
 */

export const TOAST_EVENT = "dispatch:toast";
/** Told once the store listens (sheets/toastStore.ts). */
export const TOAST_READY = "dispatch:toast-ready";

export function sendToast(detail: object, target: EventTarget = document): void {
  const send = (): boolean =>
    !target.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail, cancelable: true }));
  if (!send()) target.addEventListener(TOAST_READY, () => send(), { once: true });
}
