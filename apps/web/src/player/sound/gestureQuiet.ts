/**
 * A sheet that a finger pulled shut is silent (owner, 2026-11-03: no interface sound for swipes).
 * The gesture says so just before it closes the sheet, and the close cue that follows, wherever it
 * is chosen, takes the note once and stays quiet. No imports, so the sheets' first-load script can
 * call it without pulling the sound engine in.
 */

/**
 * The close that follows a pull comes within a frame or two (a toggle event at most). Short, so a
 * pull that a dirty sheet refused (sheetGuard.ts) cannot silence the confirmation that follows it.
 */
const PULL_CLOSE_MS = 300;

let quietUntil = 0;

/** Called by a pull or a swipe that is about to close a sheet. */
export function quietNextClose(): void {
  quietUntil = performance.now() + PULL_CLOSE_MS;
}

/** True once for the close that a pull caused. */
export function takeQuietClose(): boolean {
  const quiet = performance.now() < quietUntil;
  quietUntil = 0;
  return quiet;
}
