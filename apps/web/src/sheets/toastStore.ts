export interface ToastContent {
  /** Bumped on every show, so an identical message still re-announces and re-keys. */
  id: number;
  message: string;
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

/**
 * One toast at a time, for things that finish while their sheet is closed. A toast with an action
 * stays until it is used or dismissed, so nothing is lost to a timer.
 */
export function showToast(content: Omit<ToastContent, "id">): void {
  counter += 1;
  current = { id: counter, ...content };
  emit();
}

export function dismissToast(): void {
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
