import {
  type CSSProperties,
  type KeyboardEvent,
  type ToggleEvent,
  useEffect,
  useState,
} from "react";
import {
  MENU_BACK,
  MENU_TILE_SELECTOR,
  menuBodyClass,
  menuItemClass,
  menuItemValueClass,
  menuListClass,
  menuTileClass,
  menuTilesClass,
} from "../design-system/menu";
import {
  sheetHeadClass,
  sheetHeadingClass,
  sheetSubtitleClass,
  sheetTitleClass,
} from "../design-system/sheet";
import { sliderClass } from "../design-system/slider";
import { sendToast } from "../scripts/toastEvent";
import "../styles/slider.css";
import { longDateFromDigestId } from "./core/formatTime";
import { recordingCaption } from "./core/playerCopy";
import { getPlayerStore } from "./core/playerRuntime";
import {
  MAX_PLAYBACK_RATE,
  MIN_PLAYBACK_RATE,
  PLAYBACK_RATE_STEP,
  toPlaybackRate,
} from "./core/playerTypes";
import { queueItemUrl } from "./core/playQueue";
import { isSaved, setSaved } from "./core/saved";
import { usePlayerState } from "./hooks/usePlayer";
import { rateFace, rateLabel } from "./rateLabels";
import Icon from "./ui/LazyIcon";

/** How far under its button the menu opens where anchor positioning is missing (as QueueRow.tsx). */
const MENU_GAP_PX = 4;
const ITEM = `[role^="menuitem"]:not(:disabled):not([aria-disabled="true"]), ${MENU_TILE_SELECTOR}:not([aria-disabled="true"])`;

type Screen = "menu" | "speed";

/** The Menu is a popover list from 40rem and a bottom sheet under it (menu.css). */
const WIDE = "(width >= 40rem)";

/** True from 40rem. The tiles are the phone's sheet; a wide screen's popover is a plain list. */
function useWide(): boolean {
  // False until mounted, so the first client render is the server's.
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(WIDE);
    const update = (): void => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
}

/** The speeds the slider stops on. Between them the stepper goes by PLAYBACK_RATE_STEP. */
const SPEED_STOPS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const STOP_STEP = 0.25;
const nearestStop = (rate: number): number =>
  Math.min(
    MAX_PLAYBACK_RATE,
    Math.max(MIN_PLAYBACK_RATE, Math.round(rate / STOP_STEP) * STOP_STEP),
  );

function toast(message: string, kind?: "success" | "error"): void {
  sendToast({ message, ...(kind ? { kind } : {}) });
}

/** What this device keeps of the playing item: whether it is downloaded and whether it is saved. */
function useDeviceMarks(id: string | undefined, open: boolean) {
  const [downloaded, setDownloaded] = useState(false);
  const [saved, setSavedState] = useState(false);
  useEffect(() => {
    if (!id || !open) return;
    let live = true;
    setSavedState(isSaved(window.localStorage, id));
    void import("../scripts/libraryDownloads").then(async (library) => {
      const ids = (await library.readDownloads()).map((entry) => entry.id);
      if (live) setDownloaded(ids.includes(id));
    });
    return () => {
      live = false;
    };
  }, [id, open]);
  return { downloaded, setDownloaded, saved, setSaved: setSavedState };
}

/**
 * The player's ⋮ menu: what a listener can do with the podcast they are hearing. A phone shows it as
 * the Menu's bottom sheet, a wide screen as the Menu's popover under the button. It has two screens
 * in one sheet: the actions (Download, Share and Save as tiles, then Playback speed, Go to podcast
 * and Delete download), and Playback speed, which a Back at the head returns from. The speed sits
 * here, not in the transport, so every player says it the same way.
 */
export default function PlayerMenu() {
  const state = usePlayerState();
  const digest = state.track?.digest;
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState<Screen>("menu");
  const marks = useDeviceMarks(digest?.id, open);
  const wide = useWide();
  const menuId = "player-menu";
  const id = digest?.id ?? "";
  const title = digest ? digest.title || longDateFromDigestId(digest.id) : "Podcast";
  const rate = state.rate;
  const hide = (): void => document.getElementById(menuId)?.hidePopover();

  // Escape closes the menu alone: the player is a modal that Escape would also collapse, so the
  // menu takes the key first and marks it handled (modalScope leaves a handled Escape alone).
  useEffect(() => {
    if (!open) return;
    const onEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      document.getElementById(menuId)?.hidePopover();
    };
    window.addEventListener("keydown", onEscape, true);
    return () => window.removeEventListener("keydown", onEscape, true);
  }, [open]);

  const onToggle = (event: ToggleEvent<HTMLDivElement>): void => {
    const menu = event.currentTarget;
    const button = menu.previousElementSibling as HTMLElement | null;
    const isOpen = event.newState === "open";
    setOpen(isOpen);
    if (!isOpen) {
      setScreen("menu");
      if (menu.contains(document.activeElement) || document.activeElement === document.body)
        button?.focus({ preventScroll: true });
      return;
    }
    menu.querySelector<HTMLElement>(ITEM)?.focus({ preventScroll: true });
    if (CSS.supports("top", "anchor(bottom)")) return;
    const box = button?.getBoundingClientRect();
    if (!box) return;
    menu.style.setProperty("--menu-top", `${box.bottom + MENU_GAP_PX}px`);
    menu.style.setProperty("--menu-right", `${document.documentElement.clientWidth - box.right}px`);
  };

  // Up and Down move between the actions, Home and End to the ends; Escape is the popover's own.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (screen === "speed") return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(ITEM)];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const n = items.length;
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: n - 1 }[event.key];
    if (to === undefined || n === 0) return;
    event.preventDefault();
    items[((to % n) + n) % n]?.focus({ preventScroll: true });
  };

  const download = async (): Promise<void> => {
    if (!digest?.audio || marks.downloaded) return;
    hide();
    const library = await import("../scripts/libraryDownloads");
    const { NotReadyError } = await import("../lib/downloads");
    toast("Downloading");
    try {
      await library.download({
        id,
        audio: digest.audio.url,
        page: queueItemUrl(id),
        kind: id.startsWith("ep-") ? "episode" : "briefing",
      });
      toast("Downloaded for offline listening", "success");
    } catch (error) {
      if (error instanceof NotReadyError) toast("Not ready offline yet");
      else toast("Could not download. Check your connection and try again.", "error");
    }
  };

  const share = async (): Promise<void> => {
    hide();
    const { shareItem } = await import("../scripts/shareLink");
    const outcome = await shareItem({
      id,
      title,
      path: queueItemUrl(id),
      kind: id.startsWith("ep-") ? "episode" : "briefing",
    });
    if (typeof outcome === "object") toast(outcome.refused);
  };

  const save = (): void => {
    const next = !marks.saved;
    const kept = setSaved(window.localStorage, id, next);
    marks.setSaved(kept);
    // The tile says Saved or Save; a toast would cover the sheet. Only a refusal speaks.
    if (next && !kept) toast("Could not save on this device", "error");
  };

  const removeDownload = async (): Promise<void> => {
    hide();
    const library = await import("../scripts/libraryDownloads");
    await library.removeDownload(id);
    marks.setDownloaded(false);
    toast("Download removed");
  };

  const goToPodcast = async (): Promise<void> => {
    hide();
    const { navigateTo } = await import("./core/navigation");
    const { playerSheet } = await import("./core/playerSheet");
    await playerSheet.collapse();
    void navigateTo(queueItemUrl(id));
  };

  const head = (name: string, subtitle: string | null, back: boolean) => (
    <div className={sheetHeadClass()} data-has-back={back ? "" : undefined}>
      {back ? (
        <button
          className="icon-btn press"
          type="button"
          aria-label="Back"
          {...{ [MENU_BACK]: "" }}
          onClick={() => setScreen("menu")}
        >
          <Icon name="chevronLeft" size="lg" />
        </button>
      ) : null}
      {subtitle ? (
        <div className={sheetHeadingClass()}>
          <h2 className={sheetTitleClass()} id={`${menuId}-title`}>
            {name}
          </h2>
          <p className={sheetSubtitleClass()}>{subtitle}</p>
        </div>
      ) : (
        <h2 className={sheetTitleClass()} id={`${menuId}-title`}>
          {name}
        </h2>
      )}
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
  );

  // The thumb stands on the stop nearest the speed; the readout and the stepper say the exact one.
  const stop = nearestStop(rate);
  const fill = (stop - MIN_PLAYBACK_RATE) / (MAX_PLAYBACK_RATE - MIN_PLAYBACK_RATE);
  const setRate = (next: number): void => getPlayerStore().setRate(toPlaybackRate(next));

  return (
    <>
      <button
        className="icon-btn player-more"
        type="button"
        popoverTarget={menuId}
        aria-haspopup="menu"
        aria-label="More for this podcast"
        disabled={!digest}
      >
        <Icon name="moreVert" />
      </button>
      <div
        id={menuId}
        className={`${menuListClass()} player-menu`}
        popover="auto"
        onToggle={onToggle}
      >
        {screen === "menu" ? (
          <>
            {head(title, digest ? recordingCaption(digest) : null, false)}
            <div className={menuBodyClass()} role="menu" aria-label={title} onKeyDown={onKeyDown}>
              {wide ? (
                <>
                  <button
                    className={menuItemClass()}
                    type="button"
                    role="menuitem"
                    aria-disabled={marks.downloaded || !digest?.audio || undefined}
                    onClick={() => void download()}
                  >
                    <Icon name="download" />
                    {marks.downloaded ? "Downloaded" : "Download"}
                  </button>
                  <button
                    className={menuItemClass()}
                    type="button"
                    role="menuitem"
                    onClick={() => void share()}
                  >
                    <Icon name="shareArrow" />
                    Share
                  </button>
                  <button
                    className={menuItemClass()}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={marks.saved}
                    onClick={save}
                  >
                    <Icon name={marks.saved ? "bookmark" : "bookmarkOutline"} />
                    {marks.saved ? "Saved" : "Save"}
                  </button>
                </>
              ) : (
                <div className={menuTilesClass()}>
                  <button
                    className={menuTileClass()}
                    type="button"
                    aria-pressed={marks.downloaded}
                    aria-disabled={marks.downloaded || !digest?.audio || undefined}
                    onClick={() => void download()}
                  >
                    <Icon name="download" />
                    {marks.downloaded ? "Downloaded" : "Download"}
                  </button>
                  <button className={menuTileClass()} type="button" onClick={() => void share()}>
                    <Icon name="shareArrow" />
                    Share
                  </button>
                  <button
                    className={menuTileClass()}
                    type="button"
                    aria-pressed={marks.saved}
                    onClick={save}
                  >
                    <Icon name={marks.saved ? "bookmark" : "bookmarkOutline"} />
                    {marks.saved ? "Saved" : "Save"}
                  </button>
                </div>
              )}
              <button
                className={menuItemClass()}
                type="button"
                role="menuitem"
                aria-haspopup="true"
                onClick={() => setScreen("speed")}
              >
                <Icon name="gauge" />
                Playback speed
                <span className={menuItemValueClass()}>
                  {rateLabel(rate)}
                  <Icon name="chevronRight" />
                </span>
              </button>
              <button
                className={menuItemClass()}
                type="button"
                role="menuitem"
                onClick={() => void goToPodcast()}
              >
                <Icon name="library" />
                Go to podcast
              </button>
              {marks.downloaded ? (
                <button
                  className={menuItemClass("danger")}
                  type="button"
                  role="menuitem"
                  onClick={() => void removeDownload()}
                >
                  <Icon name="downloadRemove" />
                  Delete download
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <>
            {head("Playback speed", null, true)}
            <div className={`${menuBodyClass()} player-speed`}>
              <div className="player-speed-stepper">
                <button
                  className="icon-btn icon-btn-tonal press"
                  type="button"
                  aria-label="Slower"
                  disabled={rate <= MIN_PLAYBACK_RATE}
                  onClick={() => setRate(rate - PLAYBACK_RATE_STEP)}
                >
                  <Icon name="minus" />
                </button>
                <output className="player-speed-readout num" aria-hidden="true">
                  {rateFace(rate)}
                </output>
                <button
                  className="icon-btn icon-btn-tonal press"
                  type="button"
                  aria-label="Faster"
                  disabled={rate >= MAX_PLAYBACK_RATE}
                  onClick={() => setRate(rate + PLAYBACK_RATE_STEP)}
                >
                  <Icon name="plus" />
                </button>
              </div>
              <input
                className={sliderClass()}
                type="range"
                min={MIN_PLAYBACK_RATE}
                max={MAX_PLAYBACK_RATE}
                step={STOP_STEP}
                value={stop}
                aria-label="Playback speed"
                aria-valuetext={rateLabel(rate)}
                style={{ "--range-fill": `${(fill * 100).toFixed(1)}%` } as CSSProperties}
                onChange={(event) => setRate(event.currentTarget.valueAsNumber)}
              />
              <div className="player-speed-stops" aria-hidden="true">
                {SPEED_STOPS.map((value) => (
                  <span
                    key={value}
                    className="player-speed-stop num"
                    style={
                      {
                        "--stop":
                          (value - MIN_PLAYBACK_RATE) / (MAX_PLAYBACK_RATE - MIN_PLAYBACK_RATE),
                      } as CSSProperties
                    }
                    data-on={value === stop ? "" : undefined}
                  >
                    {Number(value.toFixed(2))}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
