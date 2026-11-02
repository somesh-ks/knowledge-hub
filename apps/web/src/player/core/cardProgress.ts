/**
 * What a card says of what the device remembers, on any page (the Library, the Earlier shelf): a
 * half-heard item shows a thin bar under its cover. A finished item shows nothing (2026-11-02: the
 * owner asked for the lighter line, so no "Played" word or mark on a card). The player keeps the
 * second it reached under singularity:resume:<id> and, once the item is finished,
 * singularity:played:<id> instead (resume.ts). readerSync.ts calls this on every page load.
 */
import { type Remembered, readRemembered, safeLocalStorage } from "./resume";

/** How far the bar goes (0 hides it), against the card's own minutes: close enough for a bar. */
export function cardProgress(remembered: Remembered, minutes: number): number {
  const total = minutes * 60;
  return total > 0 ? Math.min(remembered.seconds / total, 1) : 0;
}

export function showCardProgress(): void {
  const storage = safeLocalStorage();
  for (const card of document.querySelectorAll<HTMLElement>("[data-card]")) {
    const share = cardProgress(
      readRemembered(storage, card.dataset.id ?? ""),
      Number(card.dataset.minutes),
    );
    const bar = card.querySelector<HTMLElement>("[data-cover-progress]");
    if (bar) {
      bar.hidden = share <= 0;
      bar.style.setProperty("--progress", `${Math.round(share * 100)}%`);
    }
  }
}
