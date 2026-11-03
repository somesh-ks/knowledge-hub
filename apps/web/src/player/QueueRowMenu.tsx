import { type CSSProperties, type KeyboardEvent, type ToggleEvent, useState } from "react";
import { menuBodyClass, menuItemClass, menuListClass, menuTilesClass } from "../design-system/menu";
import {
  sheetHeadClass,
  sheetHeadingClass,
  sheetSubtitleClass,
  sheetTitleClass,
} from "../design-system/sheet";
import { downloadFailure } from "../lib/downloadCopy";
import { sendToast } from "../scripts/toastEvent";
import { getPlayQueue } from "./core/playerRuntime";
import { queueItemUrl } from "./core/playQueue";
import { loadQueueDigest } from "./core/queueMeta";
import Icon from "./ui/LazyIcon";

/** How far under its dots the menu opens where anchor positioning is missing (as PlayerMenu.tsx). */
const MENU_GAP_PX = 4;
const ITEM = '[role="menuitem"]:not(:disabled)';

/**
 * The ⋮ a mouse reaches on a queue row (owner, 2026-11-03: "on hover we show the 3 dots icon button
 * with relevant options"): Go to podcast, Share, Download and Remove from queue. player.css shows the
 * button only under a hovering pointer, so a phone keeps the handle alone and a swipe or a long press.
 * The list is the Menu: a popover under the dots, a bottom sheet under 40rem.
 */
export default function QueueRowMenu({
  id,
  title,
  subtitle,
}: {
  id: string;
  title: string;
  /** The row's quiet line ("Daily · 6 min"), under the title on a phone's sheet. */
  subtitle?: string | undefined;
}) {
  const menuId = `player-queue-menu-${id}`;
  const [downloaded, setDownloaded] = useState(false);
  const kind = id.startsWith("ep-") ? "episode" : "briefing";
  // Each row names its own dots, so its menu hangs under them and not under the last row's.
  const anchor = `--queue-more-${id}`;
  const hide = (): void => document.getElementById(menuId)?.hidePopover();

  const onToggle = (event: ToggleEvent<HTMLDivElement>): void => {
    const menu = event.currentTarget;
    const dots = menu.previousElementSibling as HTMLElement | null;
    // The row keeps its dots on view while its menu is open.
    menu
      .closest(".player-queue-item")
      ?.toggleAttribute("data-menu-open", event.newState === "open");
    if (event.newState !== "open") {
      if (menu.contains(document.activeElement) || document.activeElement === document.body)
        dots?.focus({ preventScroll: true });
      return;
    }
    void import("../scripts/libraryDownloads").then(async (library) => {
      const ids = (await library.readDownloads()).map((entry) => entry.id);
      setDownloaded(ids.includes(id));
    });
    menu.querySelector<HTMLElement>(ITEM)?.focus({ preventScroll: true });
    if (CSS.supports("top", "anchor(bottom)")) return;
    // A finger has no dots (player.css): a hold's menu hangs under the handle instead.
    const opener = dots?.offsetParent
      ? dots
      : menu.parentElement?.querySelector<HTMLElement>(".player-queue-grip");
    const box = opener?.getBoundingClientRect();
    if (!box) return;
    menu.style.setProperty("--menu-top", `${box.bottom + MENU_GAP_PX}px`);
    menu.style.setProperty("--menu-right", `${document.documentElement.clientWidth - box.right}px`);
  };

  // Up and Down move between the items, Home and End to the ends; Escape is the popover's own.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(ITEM)];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const n = items.length;
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: n - 1 }[event.key];
    if (to === undefined || n === 0) return;
    event.preventDefault();
    items[((to % n) + n) % n]?.focus({ preventScroll: true });
  };

  const goToPodcast = async (): Promise<void> => {
    hide();
    const { navigateTo } = await import("./core/navigation");
    const { playerSheet } = await import("./core/playerSheet");
    await playerSheet.collapse();
    void navigateTo(queueItemUrl(id));
  };

  const share = async (): Promise<void> => {
    hide();
    const { shareItem } = await import("../scripts/shareLink");
    const outcome = await shareItem({ id, title, path: queueItemUrl(id), kind });
    if (typeof outcome === "object") sendToast({ message: outcome.refused });
  };

  const download = async (): Promise<void> => {
    hide();
    const library = await import("../scripts/libraryDownloads");
    if (downloaded) {
      await library.removeDownload(id);
      sendToast({ message: "Download removed" });
      return;
    }
    const { NotReadyError } = await import("../lib/downloads");
    const audio = (await loadQueueDigest(id))?.audio?.url;
    if (!audio) {
      sendToast({ message: "Not ready offline yet" });
      return;
    }
    sendToast({ message: "Downloading" });
    try {
      await library.download({ id, audio, page: queueItemUrl(id), kind });
      sendToast({ message: "Downloaded for offline listening", kind: "success" });
    } catch (error) {
      if (error instanceof NotReadyError) sendToast({ message: "Not ready offline yet" });
      else sendToast({ message: downloadFailure(error), kind: "error" });
    }
  };

  return (
    <>
      <button
        className="icon-btn player-queue-more"
        type="button"
        popoverTarget={menuId}
        aria-haspopup="menu"
        aria-label={`More for ${title}`}
        style={{ "--queue-anchor": anchor } as CSSProperties}
      >
        <Icon name="moreVert" />
      </button>
      <div
        id={menuId}
        className={`${menuListClass()} player-queue-menu`}
        popover="auto"
        style={{ "--queue-anchor": anchor } as CSSProperties}
        onToggle={onToggle}
      >
        {/* The Library card's sheet (LibraryItemMenu.astro): its header, its quick actions as tiles on
            a phone and rows from 40rem, with Remove from queue where a card has Add to queue. Not the
            danger tone: the podcast stays in the Library, so nothing is lost (owner, 2026-11-03). */}
        <div className={sheetHeadClass()}>
          <div className={sheetHeadingClass()}>
            <h2 className={sheetTitleClass()} id={`${menuId}-title`}>
              {title}
            </h2>
            {subtitle ? <p className={sheetSubtitleClass()}>{subtitle}</p> : null}
          </div>
          <button
            className="icon-btn press"
            type="button"
            aria-label="Close"
            popoverTarget={menuId}
            popoverTargetAction="hide"
          >
            <Icon name="close" size="lg" />
          </button>
        </div>
        <div className={menuBodyClass()} role="menu" aria-label={title} onKeyDown={onKeyDown}>
          <div className={menuTilesClass()} data-fold="" role="presentation">
            <button
              className={menuItemClass()}
              type="button"
              role="menuitem"
              onClick={() => void download()}
            >
              <Icon name={downloaded ? "downloadRemove" : "download"} />
              {downloaded ? "Remove download" : "Download"}
            </button>
            <button
              className={menuItemClass()}
              type="button"
              role="menuitem"
              onClick={() => void share()}
            >
              <Icon name="shareFat" />
              Share
            </button>
            <button
              className={menuItemClass()}
              type="button"
              role="menuitem"
              onClick={() => {
                hide();
                getPlayQueue().remove(id);
              }}
            >
              <Icon name="queueRemove" />
              Remove from queue
            </button>
          </div>
          <button
            className={menuItemClass()}
            type="button"
            role="menuitem"
            onClick={() => void goToPodcast()}
          >
            <Icon name="library" />
            Go to podcast
          </button>
        </div>
      </div>
    </>
  );
}
