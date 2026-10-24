/**
 * The app's toast, asked for by event from code that must not import its store
 * (sheets/toastStore.ts): the import would split the store out of the sheets' chunk, a cost on
 * every page's first load. The store loads with the sheets at idle and takes the event by
 * cancelling it; one sent before it has loaded waits for the store's ready signal, so it is never
 * lost. A detail is a toast's content, or `{ dismiss: message }` to take that one away.
 */

export const TOAST_EVENT = "singularity:toast";
/** Told once the store listens (sheets/toastStore.ts). */
export const TOAST_READY = "singularity:toast-ready";

export interface SendOptions {
  /** Toasts waiting under one key are one toast: a later send replaces the waiting one. */
  key?: string;
  /** Asked when the toast would show, before or after the store loads: true drops it. */
  unless?: () => boolean;
}

const waiting = new WeakMap<EventTarget, Map<string, () => void>>();

export function sendToast(
  detail: object,
  target: EventTarget = document,
  options: SendOptions = {},
): void {
  const send = (): boolean =>
    !target.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail, cancelable: true }));
  if (options.unless?.()) return;
  if (send()) return;
  const { key } = options;
  const later = (): void => {
    if (key) waiting.get(target)?.delete(key);
    if (!options.unless?.()) send();
  };
  if (key) {
    const held = waiting.get(target) ?? new Map<string, () => void>();
    waiting.set(target, held);
    const earlier = held.get(key);
    if (earlier) target.removeEventListener(TOAST_READY, earlier);
    held.set(key, later);
  }
  target.addEventListener(TOAST_READY, later, { once: true });
}
