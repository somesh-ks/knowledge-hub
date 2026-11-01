import {
  addDeleted,
  DELETED_KEY,
  type DeletedEpisode,
  parseDeleted,
  pruneDeleted,
} from "../lib/deletedEpisodes";
import { HISTORY_KEY, parseHistory, parseQueue, QUEUE_KEY } from "../player/core/playQueue";
import { libraryAddress } from "./libraryAddress";

/**
 * Hides episodes this device has deleted until the redeploy catches up (lib/deletedEpisodes.ts
 * holds the rules). Loaded only when the list is not empty, or by the episode page that adds to it.
 * The Library's cards are removed from the incoming document before it is swapped in, so there is
 * no flash, and the Library's own script reads only what is left.
 */
const ID_FROM_HREF = /^\/[ed]\/([^/?#]+)/;

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
  // install() ran before this delete (or on an earlier one), so the queue and download need it now.
  dropFromDevice(id);
}

/** Drops from `doc` what the list hides, and tidies the list when `doc` is the Library. */
function hideIn(doc: Document): void {
  const stored = load();
  if (!stored.length) return;
  const cards = [...doc.querySelectorAll("[data-library-grid] [data-card]")];
  const present = cards.length ? new Set(cards.map(cardId)) : null;
  const kept = pruneDeleted(stored, present, Date.now());
  if (kept.length !== stored.length) save(kept);
  let removed = 0;
  for (const card of cards) {
    if (!kept.some((entry) => entry.id === cardId(card))) continue;
    card.remove();
    removed += 1;
  }
  // A month whose cards are all gone loses its heading too, before the page is drawn.
  if (removed > 0) {
    for (const head of doc.querySelectorAll("[data-library-grid] [data-month-head]")) {
      const next = head.nextElementSibling;
      if (!next || next.hasAttribute("data-month-head")) head.remove();
    }
  }
  // The Library's script may have counted its cards before this module loaded: it counts again.
  if (doc === document && removed > 0)
    document.dispatchEvent(new Event("singularity:library-pruned"));
}

/**
 * A page for a deleted episode has nothing to show: go to the Library as it was left. Latest (/)
 * is the exception: it shows the newest item, so it moves to the next newest one the server listed.
 */
function leaveIfDeleted(): void {
  if (location.pathname === "/") {
    const root = document.documentElement.dataset;
    const gone = new Set(load().map((entry) => entry.id));
    if (!root.digestId || !gone.has(root.digestId)) return;
    const next = (root.latestFallback ?? "")
      .split(" ")
      .find((href) => href && !gone.has(ID_FROM_HREF.exec(href)?.[1] ?? ""));
    location.replace(next ?? libraryAddress());
    return;
  }
  const id = ID_FROM_HREF.exec(location.pathname)?.[1];
  if (id && load().some((entry) => entry.id === id)) location.replace(libraryAddress());
}

/** A deleted episode leaves this device's queue and its offline copy: it must never play from either. */
function dropFromDevice(accepted?: string): void {
  const gone = new Set(load().map((entry) => entry.id));
  // The accepted id counts even when blocked storage could not keep it.
  if (accepted) gone.add(accepted);
  if (!gone.size) return;
  try {
    const queued = parseQueue(localStorage.getItem(QUEUE_KEY));
    const kept = queued.filter((id) => !gone.has(id));
    if (kept.length !== queued.length) {
      if (kept.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(kept));
      else localStorage.removeItem(QUEUE_KEY);
    }
    // The items that played, and the one playing, are listed too (D277).
    const history = parseHistory(localStorage.getItem(HISTORY_KEY));
    const played = history.played.filter((id) => !gone.has(id));
    const current = history.current && gone.has(history.current) ? null : history.current;
    if (played.length !== history.played.length || current !== history.current) {
      if (played.length || current)
        localStorage.setItem(HISTORY_KEY, JSON.stringify({ played, current }));
      else localStorage.removeItem(HISTORY_KEY);
    }
  } catch {
    // Storage can be blocked; the queue then stays as it was.
  }
  // One run at a time: removeDownload rewrites the whole manifest, so overlapping runs could
  // restore what the newer one removed. A failure on one item does not stop the others.
  cleanup = cleanup.then(async () => {
    try {
      const { readDownloads, removeDownload } = await import("./libraryDownloads");
      for (const { id } of await readDownloads()) {
        if (!gone.has(id)) continue;
        try {
          await removeDownload(id);
        } catch (error) {
          console.error(`[deleted episodes] removing the download of ${id} failed`, error);
        }
      }
    } catch (error) {
      console.error("[deleted episodes] download cleanup failed", error);
    }
  });
}

let cleanup: Promise<void> = Promise.resolve();

let installed = false;

function install(): void {
  if (installed) return;
  installed = true;
  document.addEventListener("astro:before-swap", (event) => hideIn(event.newDocument));
  document.addEventListener("astro:page-load", leaveIfDeleted);
  hideIn(document);
  leaveIfDeleted();
  dropFromDevice();
}

install();
