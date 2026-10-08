import {
  addDeleted,
  DELETED_KEY,
  type DeletedEpisode,
  parseDeleted,
  pruneDeleted,
} from "../lib/deletedEpisodes";

/**
 * Hides episodes this device has deleted until the redeploy catches up (lib/deletedEpisodes.ts
 * holds the rules). Loaded only when the list is not empty, or by the episode page that adds to it.
 * The Library's cards are removed from the incoming document before it is swapped in, so there is
 * no flash, and the Library's own script reads only what is left.
 */
const ID_FROM_HREF = /^\/e\/([^/?#]+)/;

const load = (): DeletedEpisode[] => {
  try {
    return parseDeleted(localStorage.getItem(DELETED_KEY));
  } catch {
    return [];
  }
};

function save(list: DeletedEpisode[]): void {
  try {
    if (list.length) localStorage.setItem(DELETED_KEY, JSON.stringify(list));
    else localStorage.removeItem(DELETED_KEY);
  } catch {
    // Storage can be blocked; the delete still went through.
  }
}

const cardId = (card: Element): string =>
  ID_FROM_HREF.exec(card.querySelector("a")?.getAttribute("href") ?? "")?.[1] ?? "";

/** Remembers a delete the server accepted. */
export function rememberDeleted(id: string): void {
  save(addDeleted(load(), id, Date.now()));
}

/** Drops from `doc` what the list hides, and tidies the list when `doc` is the Library. */
function hideIn(doc: Document): void {
  const stored = load();
  if (!stored.length) return;
  const cards = [...doc.querySelectorAll("[data-library-grid] [data-card]")];
  const present = cards.length ? new Set(cards.map(cardId)) : null;
  const kept = pruneDeleted(stored, present, Date.now());
  if (kept.length !== stored.length) save(kept);
  for (const card of cards) if (kept.some((entry) => entry.id === cardId(card))) card.remove();
}

/** A page for a deleted episode has nothing to show: go to the Library. */
function leaveIfDeleted(): void {
  const id = ID_FROM_HREF.exec(location.pathname)?.[1];
  if (id && load().some((entry) => entry.id === id)) location.replace("/library");
}

let installed = false;

function install(): void {
  if (installed) return;
  installed = true;
  document.addEventListener("astro:before-swap", (event) => hideIn(event.newDocument));
  document.addEventListener("astro:page-load", leaveIfDeleted);
  hideIn(document);
  leaveIfDeleted();
}

install();
