/**
 * When a page may ask for its first segments in the background. Plain checks, so the narration
 * runtime can decide before it asks anything.
 */
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

/** Checks the browser and marks the page tried. True when the prewarm may go ahead. */
export function startPrewarm(id: string): boolean {
  const connection = (navigator as Navigator & { connection?: Connection }).connection;
  const allowed = prewarmAllowed({
    hidden: document.hidden,
    saveData: connection?.saveData === true,
    online: navigator.onLine,
  });
  if (!allowed) return false;
  let storage: Storage | null = null;
  try {
    storage = window.sessionStorage;
  } catch {
    storage = null;
  }
  return claimPrewarm(storage, id);
}
