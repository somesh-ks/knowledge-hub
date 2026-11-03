/**
 * What a card, and a page's header, say of what the device remembers: a half-heard item shows a thin bar
 * under its cover, and an item heard to the end shows a green check after its facts (owner, 2026-11-03).
 * The word Played is not on a card or on the play button; the check is the whole of it. The player keeps
 * the second it reached under singularity:resume:<id> and, once the item is finished,
 * singularity:played:<id> instead (resume.ts). readerSync.ts calls this on every page load.
 */
import { type Remembered, readRemembered, safeLocalStorage } from "./resume";

/** How far the bar goes (0 hides it), against the card's own minutes: close enough for a bar. */
export function cardProgress(remembered: Remembered, minutes: number): number {
  const total = minutes * 60;
  return total > 0 ? Math.min(remembered.seconds / total, 1) : 0;
}

/** Heard to the end and not begun again: a position of its own means it is being heard once more. */
export function isPlayed(remembered: Remembered): boolean {
  return remembered.played && remembered.seconds <= 0;
}

/** A page's header says "Played" at the end of its facts line (components/HeroMarks.astro). */
function markHero(facts: HTMLElement, on: boolean): void {
  const marked = facts.querySelector(".hero-played");
  if (!on) marked?.remove();
  else if (!marked) {
    const mark = facts.querySelector<HTMLTemplateElement>("template[data-played-mark]");
    if (!mark) return;
    // Before Downloaded when that is there already, so the two keep one order.
    const after = facts.querySelector(".hero-downloaded");
    if (after) after.before(mark.content.cloneNode(true));
    else facts.append(mark.content.cloneNode(true));
  }
}

export function showCardProgress(): void {
  const storage = safeLocalStorage();
  for (const card of document.querySelectorAll<HTMLElement>("[data-card]")) {
    const remembered = readRemembered(storage, card.dataset.id ?? "");
    card.toggleAttribute("data-played", isPlayed(remembered));
    const share = cardProgress(remembered, Number(card.dataset.minutes));
    const bar = card.querySelector<HTMLElement>("[data-cover-progress]");
    if (bar) {
      bar.hidden = share <= 0;
      bar.style.setProperty("--progress", `${Math.round(share * 100)}%`);
    }
  }
  const facts = document.querySelector<HTMLElement>(".hero-facts[data-played-id]");
  if (facts) markHero(facts, isPlayed(readRemembered(storage, facts.dataset.playedId ?? "")));
}
