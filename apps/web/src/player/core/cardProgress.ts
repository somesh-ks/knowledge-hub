/**
 * What a card says of what the device remembers, on any page (the Library, the Earlier shelf): a
 * half-heard item shows a thin bar under its cover, and a finished one says "Played": a mark after the
 * facts in the Library, in place of the length on a narrow shelf. The player keeps the second it
 * reached under singularity:resume:<id> and, once the item is finished, singularity:played:<id>
 * instead (resume.ts). readerSync.ts calls this on every page load.
 */
import { type Remembered, readRemembered, safeLocalStorage } from "./resume";

/** How far the bar goes (0 hides it), against the card's own minutes: close enough for a bar. */
export function cardProgress(
  remembered: Remembered,
  minutes: number,
): { share: number; played: boolean } {
  const total = minutes * 60;
  const share = total > 0 ? Math.min(remembered.seconds / total, 1) : 0;
  // A position of its own means it is being heard again: the bar, not Played.
  return { share, played: remembered.played && share <= 0 };
}

export function showCardProgress(): void {
  const storage = safeLocalStorage();
  for (const card of document.querySelectorAll<HTMLElement>("[data-card]")) {
    const { share, played } = cardProgress(
      readRemembered(storage, card.dataset.id ?? ""),
      Number(card.dataset.minutes),
    );
    // The Library's rows keep their facts whole and say "Played" with a mark after them (library.css), so
    // a row says the same in the list and the gallery. A narrow shelf has no room for a mark: there
    // "Played" takes the length's place, so it never wraps onto a line of its own and the kind stays.
    if (card.closest("[data-library]")) card.toggleAttribute("data-played", played);
    else {
      const length = card.querySelector<HTMLElement>("[data-card-length]");
      if (length) {
        length.dataset.minutes ??= length.textContent ?? "";
        length.parentElement?.toggleAttribute("data-played", played);
        length.textContent = played ? "Played" : length.dataset.minutes;
      }
    }
    const bar = card.querySelector<HTMLElement>("[data-cover-progress]");
    if (bar) {
      bar.hidden = share <= 0;
      bar.style.setProperty("--progress", `${Math.round(share * 100)}%`);
    }
  }
}
