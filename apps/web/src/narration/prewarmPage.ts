/**
 * Asks for the first segments of the page's briefing or episode while the browser is idle, so that
 * Play has a file to start with. Loaded on demand from the page; none of it is first-load code.
 */
import { getPlayerStore } from "../player/core/playerRuntime";

const KEY_PREFIX = "dispatch:prewarm:";

interface Connection {
  saveData?: boolean;
}

/** True when this tab has not yet tried this page, and marks it tried. Storage that fails says no. */
export function claimPrewarm(
  storage: Pick<Storage, "getItem" | "setItem"> | null,
  id: string,
): boolean {
  try {
    if (!storage || storage.getItem(KEY_PREFIX + id) !== null) return false;
    storage.setItem(KEY_PREFIX + id, "1");
    return true;
  } catch {
    return false;
  }
}

/** The conditions under which a background request is not welcome. */
export function prewarmAllowed(env: {
  hidden: boolean;
  saveData: boolean;
  online: boolean;
}): boolean {
  return !env.hidden && !env.saveData && env.online;
}

function whenIdle(task: () => void): void {
  if (typeof requestIdleCallback === "function") requestIdleCallback(task, { timeout: 3_000 });
  else setTimeout(task, 1_500);
}

export function prewarmWhenIdle(): void {
  whenIdle(() => {
    const page = getPlayerStore().getPageDigest();
    // The page is read again at idle: the listener may have moved on, or audio may have arrived.
    if (!page || page.audio) return;
    const connection = (navigator as Navigator & { connection?: Connection }).connection;
    const allowed = prewarmAllowed({
      hidden: document.hidden,
      saveData: connection?.saveData === true,
      online: navigator.onLine,
    });
    if (!allowed) return;
    let storage: Storage | null = null;
    try {
      storage = window.sessionStorage;
    } catch {
      storage = null;
    }
    if (!claimPrewarm(storage, page.id)) return;
    void import("./narrationRuntime").then((narration) => narration.prewarmPage(page));
  });
}
