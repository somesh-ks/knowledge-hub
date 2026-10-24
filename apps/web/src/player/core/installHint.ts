import type { StorageLike } from "./resume";

export const INSTALL_VISITS_KEY = "singularity:install-hint-visits";
export const INSTALL_DISMISSED_KEY = "singularity:install-hint-dismissed";
/** Visits before the hint appears: a hint on first paint is spam. */
export const INSTALL_HINT_MIN_VISITS = 2;

export interface InstallHintContext {
  userAgent: string;
  maxTouchPoints: number;
  isStandalone: boolean;
  dismissed: boolean;
  visits: number;
}

/** iPadOS 13 and later reports a Mac user agent, so touch points tell the two apart. */
export function isIos(userAgent: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/**
 * Safari itself. Chrome, Firefox and Edge on iOS reach Add to Home Screen through menus the copy
 * does not describe, and in-app browsers cannot add anything. A real Safari user agent carries
 * both "Version/" and "Safari/"; WebViews drop "Safari/".
 */
export function isIosSafari(userAgent: string, maxTouchPoints: number): boolean {
  if (!isIos(userAgent, maxTouchPoints)) return false;
  if (/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram|Line\/|Twitter/.test(userAgent)) {
    return false;
  }
  return /Safari\//.test(userAgent) && /Version\//.test(userAgent);
}

export function shouldShowInstallHint(context: InstallHintContext): boolean {
  if (!isIosSafari(context.userAgent, context.maxTouchPoints)) return false;
  if (context.isStandalone) return false;
  if (context.dismissed) return false;
  return context.visits >= INSTALL_HINT_MIN_VISITS;
}

export function readVisits(storage: StorageLike | null): number {
  try {
    const value = Number(storage?.getItem(INSTALL_VISITS_KEY) ?? "0");
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

export function readDismissed(storage: StorageLike | null): boolean {
  try {
    return storage?.getItem(INSTALL_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Dismissal is permanent, not per session. */
export function dismissInstallHint(storage: StorageLike | null): void {
  try {
    storage?.setItem(INSTALL_DISMISSED_KEY, "1");
  } catch {
    // Best effort.
  }
}

let visitRecorded = false;

/**
 * Counts one visit per top-level document load. Same-document navigations do not count, and the
 * guard makes a duplicate call during one document harmless.
 */
export function recordInstallVisit(storage: StorageLike | null): number {
  if (visitRecorded) return readVisits(storage);
  visitRecorded = true;
  const visits = readVisits(storage) + 1;
  try {
    storage?.setItem(INSTALL_VISITS_KEY, String(visits));
  } catch {
    // Best effort.
  }
  return visits;
}

/** For tests: forget that this document already recorded its visit. */
export function resetVisitGuard(): void {
  visitRecorded = false;
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const navigatorWithFlag = navigator as NavigatorWithStandalone;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    navigatorWithFlag.standalone === true
  );
}
