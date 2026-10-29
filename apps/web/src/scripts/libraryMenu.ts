/**
 * The ⋮ menu at the end of each Library row (components/LibraryItemMenu.astro): Download, Add to
 * queue, Share, and Regenerate and Delete, which are the episode and briefing pages' own dialogs
 * (episodeActionsEntry.ts, episodeActions.ts, the Generate sheet) opened from here. The popover,
 * its keys and its placement are the header More menu's (heroMenu.ts). Which rows are downloaded is
 * read from Cache Storage on load and after every change. The briefing and episode pages' More menu
 * (HeroMenu.astro, `data-page-menu`) offers the same Download and Add to queue and is wired here too.
 */
import { track } from "../lib/analytics";
import { NotReadyError } from "../lib/downloads";
import { installEpisodeActions } from "./episodeActionsEntry";
import { installHeroMenu } from "./heroMenu";
import { shareItem, stopSharing, syncStopSharing } from "./shareLink";
import { sendToast } from "./toastEvent";

const ROOT = "[data-library-menu]";
/** A Library row's menu, or the More menu of a page: the roots Download and Add to queue act from. */
const ITEM_ROOT = `${ROOT}, [data-page-menu]`;

/** Where the downloaded state is kept: the row's card, or the menu itself on a page. */
const holderOf = (root: HTMLElement): HTMLElement =>
  root.closest<HTMLElement>("[data-card]") ?? root;

function toast(message: string, kind?: "success" | "error"): void {
  sendToast({ message, ...(kind ? { kind } : {}) });
}

/** A page's header says "Downloaded" at the end of its facts line (components/HeroDownloaded.astro). */
function markHero(on: boolean): void {
  const facts = document.querySelector(".hero-facts");
  const marked = facts?.querySelector(".hero-downloaded");
  if (!on) marked?.remove();
  else if (facts && !marked) {
    const mark = facts.querySelector<HTMLTemplateElement>("template[data-downloaded-mark]");
    if (mark) facts.append(mark.content.cloneNode(true));
  }
}

function setDownloaded(root: HTMLElement, on: boolean): void {
  holderOf(root).toggleAttribute("data-downloaded", on);
  const sub = root.closest("[data-card]")?.querySelector(".card-sub");
  const marked = sub?.querySelector(".card-downloaded");
  if (!on) marked?.remove();
  else if (sub && !marked) {
    const mark = root
      .closest("[data-card]")
      ?.querySelector<HTMLTemplateElement>("template[data-downloaded-mark]");
    if (mark) sub.prepend(mark.content.cloneNode(true));
  }
  if (holderOf(root) === root) markHero(on);
  const item = root.querySelector<HTMLElement>('[data-menu="download"]');
  const label = item?.querySelector("[data-menu-label]");
  if (label) label.textContent = on ? "Remove download" : "Download";
  // The item's icon follows the card's data-downloaded (library.css, .dl-remove).
}

/** Marks the rows whose files are saved on this device. */
export async function syncDownloads(): Promise<void> {
  if (!document.querySelector(ITEM_ROOT)) return;
  const { readDownloads } = await import("./libraryDownloads");
  const ids = new Set((await readDownloads()).map((entry) => entry.id));
  for (const root of document.querySelectorAll<HTMLElement>(ITEM_ROOT)) {
    setDownloaded(root, ids.has(root.dataset.id ?? ""));
  }
}

async function toggleDownload(root: HTMLElement): Promise<void> {
  const { id = "", audio = "", path = "", episode } = root.dataset;
  const card = holderOf(root);
  if (!id || !audio || card.hasAttribute("data-downloading")) return;
  const library = await import("./libraryDownloads");
  try {
    if (card.hasAttribute("data-downloaded")) {
      await library.removeDownload(id);
      toast("Download removed");
    } else {
      card.setAttribute("data-downloading", "");
      toast("Downloading");
      await library.download({
        id,
        audio,
        page: path,
        kind: episode ? "episode" : "briefing",
      });
      toast("Downloaded for offline listening", "success");
      track("download", { kind: episode ? "episode" : "briefing" });
    }
  } catch (error) {
    // A turn without its file yet: a download never spends narration to make it.
    if (error instanceof NotReadyError) toast("Not ready offline yet");
    else toast("Could not download. Check your connection and try again.", "error");
  } finally {
    card.removeAttribute("data-downloading");
    await syncDownloads();
  }
}

async function onPick(item: HTMLElement): Promise<void> {
  const root = item.closest<HTMLElement>(ITEM_ROOT);
  if (!root) return;
  const { id = "", path = "", title = "" } = root.dataset;
  switch (item.dataset.menu) {
    case "download":
      await toggleDownload(root);
      return;
    case "queue": {
      // The player answers in the event's detail (playerRuntime.ts): an item queued already, or
      // playing now, is not added twice.
      const detail: { id: string; added?: boolean } = { id };
      document.dispatchEvent(new CustomEvent("singularity:queue-add", { detail }));
      toast(detail.added === false ? "Already in the queue" : "Added to queue");
      return;
    }
    case "share": {
      const outcome = await shareItem({
        id,
        title,
        path,
        kind: root.dataset.episode ? "episode" : "briefing",
      });
      // The share dialog says its own "Copied" (shareDialog.ts).
      if (typeof outcome === "object") toast(outcome.refused);
      return;
    }
    case "unshare":
      if (await stopSharing(id)) toast("Stopped sharing", "success");
      else toast("Could not stop sharing. Try again.", "error");
      return;
  }
}

let installed = false;

export function installLibraryMenu(): void {
  if (installed) return;
  installed = true;
  installHeroMenu();
  installEpisodeActions();

  // The Generate sheet replaces the briefing named by the first [data-briefing] on the page, and a
  // Library holds many: only the row being regenerated carries it, and only while the sheet opens.
  document.addEventListener(
    "click",
    (event) => {
      const item = (event.target as Element).closest?.<HTMLElement>(
        `${ROOT} [data-open="generate"]`,
      );
      if (!item) return;
      for (const other of document.querySelectorAll(`${ROOT}[data-briefing]`)) {
        other.removeAttribute("data-briefing");
      }
      const root = item.closest<HTMLElement>(ROOT);
      if (root?.dataset.libraryBriefing) root.dataset.briefing = root.dataset.libraryBriefing;
    },
    true,
  );

  document.addEventListener("click", (event) => {
    const item = (event.target as Element).closest?.<HTMLElement>(`:is(${ITEM_ROOT}) [data-menu]`);
    if (item && item.getAttribute("aria-disabled") !== "true") void onPick(item);
  });

  // The menus answer from here on (the browser suite waits for it).
  const ready = (): void => {
    document.querySelector("[data-library]")?.setAttribute("data-menus-ready", "");
    // Download and Add to queue are served dimmed (aria-disabled) until their handler exists.
    for (const menu of document.querySelectorAll("[data-page-menu]")) {
      menu.setAttribute("data-menus-ready", "");
      for (const item of menu.querySelectorAll('[data-menu][aria-disabled="true"]'))
        item.removeAttribute("aria-disabled");
    }
    syncStopSharing();
    void syncDownloads();
  };
  document.addEventListener("astro:page-load", ready);
  ready();
}
