/**
 * Chrome and Edge on Android offer the install prompt once, early, and only to a page that is listening.
 * This runs on every page, keeps the event, and lets the Settings page ask for the prompt later.
 */
interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
}

let held: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
let captured = false;

const notify = (): void => {
  for (const listener of listeners) listener();
};

export function installPromptReady(): boolean {
  return held !== null;
}

export function onInstallPromptChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Shows the browser's install dialog. An event can be used once, so it is dropped either way. */
export async function requestInstall(): Promise<void> {
  const event = held;
  if (!event) return;
  held = null;
  notify();
  try {
    await event.prompt();
  } catch {
    // The browser refused: the row is gone until it offers again.
  }
}

export function captureInstallPrompt(): void {
  if (captured) return;
  captured = true;
  addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    held = event as InstallPromptEvent;
    notify();
  });
  addEventListener("appinstalled", () => {
    held = null;
    notify();
  });
}
