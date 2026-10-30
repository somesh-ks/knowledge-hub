import { TOAST_EVENT, TOAST_READY } from "../scripts/toastEvent";

export interface ToastContent {
  /** Bumped on every show, so an identical message still re-announces and re-keys. */
  id: number;
  message: string;
  /** A finished run that worked, or one that did not: it gets an icon and, for an error, an alert role. */
  kind?: "success" | "error";
  actionLabel?: string;
  onAction?: () => void;
  /** Its words stay on one line, cut with an ellipsis when they cannot fit: a short message only. */
  oneLine?: boolean;
  /** Run when the person closes the toast without using its action (its close button, a swipe). */
  onDismiss?: () => void;
}

type Listener = () => void;

let current: ToastContent | null = null;
let counter = 0;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** How long a message with no action stays. */
export const TOAST_MS = 5000;
let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * One toast at a time, for things that finish while their sheet is closed; a new one replaces the
 * old. A toast with an action stays until it is used or dismissed, so nothing is lost to a timer;
 * one without goes by itself.
 */
export function showToast(content: Omit<ToastContent, "id">): void {
  counter += 1;
  clearTimeout(timer);
  current = { id: counter, ...content };
  if (!content.actionLabel) timer = setTimeout(dismissToast, TOAST_MS);
  emit();
}

export function dismissToast(): void {
  clearTimeout(timer);
  if (!current) return;
  current = null;
  emit();
}

export function subscribeToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getToast(): ToastContent | null {
  return current;
}

/**
 * Asked for by code that must not import this store (scripts/toastEvent.ts): a toast's content to
 * show, or `{ dismiss: message }` to take that one away if it is still up.
 */
globalThis.document?.addEventListener(TOAST_EVENT, (event) => {
  // Taken: a sender that ran before this store loaded waits for TOAST_READY instead.
  event.preventDefault();
  const detail = (event as CustomEvent).detail;
  if (detail?.dismiss === undefined) showToast(detail);
  else if (current?.message === detail.dismiss) dismissToast();
});
/** Told once this store listens, for a toast asked for before it loaded. */
globalThis.document?.dispatchEvent(new Event(TOAST_READY));
