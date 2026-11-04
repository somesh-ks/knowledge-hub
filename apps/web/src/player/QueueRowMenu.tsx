import { type CSSProperties, type KeyboardEvent, type ToggleEvent, useState } from "react";
import { menuBodyClass, menuItemClass, menuListClass, menuTilesClass } from "../design-system/menu";
import {
  sheetHeadClass,
  sheetHeadingClass,
  sheetSubtitleClass,
  sheetTitleClass,
} from "../design-system/sheet";
import { downloadFailure } from "../lib/downloadCopy";
import { inPodcastOrder, type PodcastAction, TILE_COUNT, TILES_MIN } from "../lib/podcastActions";
import { sendToast } from "../scripts/toastEvent";
import { getPlayQueue } from "./core/playerRuntime";
import { queueItemUrl } from "./core/playQueue";
import { loadQueueDigest } from "./core/queueMeta";
import { deviceStorage, isSaved, setSaved } from "./core/saved";
import type { IconName } from "./ui/iconPathsLazy";
import Icon from "./ui/LazyIcon";

/** How far under its dots the menu opens where anchor positioning is missing (as PlayerMenu.tsx). */
const MENU_GAP_PX = 4;
const ITEM = '[role="menuitem"]:not(:disabled)';

/**
 * The ⋮ a mouse reaches on a queue row (owner, 2026-11-03: "on hover we show the 3 dots icon button
 * with relevant options"): the podcast's sheet, with Remove from queue and Go to podcast. player.css shows the
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
  const [favorite, setFavorite] = useState(false);
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
    setFavorite(isSaved(deviceStorage(), id));
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
    // The toggle comes after the open, so the menu has its height: one that would run off the
    // bottom (a hold low on a tablet) opens above its opener instead.
    const below = box.bottom + MENU_GAP_PX;
    const fits = below + menu.offsetHeight <= document.documentElement.clientHeight;
    const top = fits ? below : Math.max(0, box.top - MENU_GAP_PX - menu.offsetHeight);
    menu.style.setProperty("--menu-top", `${top}px`);
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

  const toggleFavorite = (): void => {
    hide();
    // Read now, not when the menu opened: another tab may have changed it since.
    const storage = deviceStorage();
    const on = !isSaved(storage, id);
    if (setSaved(storage, id, on))
      sendToast({ message: on ? "Added to favorites" : "Removed from favorites" });
    else
      sendToast({
        message: on ? "Couldn't add it to favorites" : "Couldn't remove it from favorites",
        kind: "error",
      });
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

  /** This row's actions, in every podcast sheet's one order (lib/podcastActions.ts, D369). */
  const ACTIONS: Partial<
    Record<PodcastAction, { icon: IconName; label: string; act: () => void }>
  > = {
    favorite: {
      icon: favorite ? "heart" : "heartOutline",
      label: favorite ? "Remove from favorites" : "Add to favorites",
      act: toggleFavorite,
    },
    // Where a card has Add to queue. Not the danger tone: the podcast stays in the Library, so
    // nothing is lost (owner, 2026-11-03).
    queue: {
      icon: "queueRemove",
      label: "Remove from queue",
      act: () => {
        hide();
        getPlayQueue().remove(id);
      },
    },
    share: { icon: "shareFat", label: "Share", act: () => void share() },
    download: {
      icon: downloaded ? "trash" : "download",
      label: downloaded ? "Remove download" : "Download",
      act: () => void download(),
    },
    podcast: { icon: "library", label: "Go to podcast", act: () => void goToPodcast() },
  };
  const actions = inPodcastOrder(Object.keys(ACTIONS) as PodcastAction[]);
  const tiles = actions.length >= TILES_MIN ? actions.slice(0, TILE_COUNT) : [];
  const rows = actions.filter((action) => !tiles.includes(action));
  const item = (action: PodcastAction) => {
    const { icon, label, act } = ACTIONS[action] ?? {};
    if (!icon || !act) return null;
    return (
      <button
        key={action}
        className={menuItemClass()}
        type="button"
        role="menuitem"
        data-menu={action}
        onClick={act}
      >
        <Icon name={icon} />
        {label}
      </button>
    );
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
        {/* The Library card's sheet (PodcastMenuItems.astro): its header, then its actions in the one
            order, the first three as tiles on a phone's sheet once there are enough (D369). */}
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
          {tiles.length > 0 ? (
            <div className={menuTilesClass()} data-fold="" role="presentation">
              {tiles.map(item)}
            </div>
          ) : null}
          {rows.map(item)}
        </div>
      </div>
    </>
  );
}
