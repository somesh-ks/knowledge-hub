export interface ToastContent {
  /** Bumped on every show, so an identical message still re-announces and re-keys. */
  id: number;
  message: string;
  /** A finished run that worked, or one that did not: it gets an icon and, for an error, an alert role. */
  kind?: "success" | "error";
  actionLabel?: string;
  onAction?: () => void;
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
 * Asked for by code that must not import this store (scripts/managePageSave.ts): a toast's content to
 * show, or `{ dismiss: message }` to take that one away if it is still up.
 */
export const TOAST_EVENT = "dispatch:toast";
globalThis.document?.addEventListener(TOAST_EVENT, (event) => {
  const detail = (event as CustomEvent).detail;
  if (detail?.dismiss === undefined) showToast(detail);
  else if (current?.message === detail.dismiss) dismissToast();
});
