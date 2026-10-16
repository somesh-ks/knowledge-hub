import { installCreateEntry } from "./createEntry";
import { installDeviceBanners } from "./deviceBanners";
import { installDisabledGuard } from "./disabledGuard";
import { captureInstallPrompt } from "./installPrompt";
import { installNavigation } from "./navigation";
import { installThemeColor } from "./themeColor";
import { installUiSound } from "./uiSound";

/**
 * Page-level behavior that belongs to the shell, not to the player: navigation rules, device
 * banners, the disabled-control guard, the browser chrome colour and the service worker. Loaded once
 * from the layout. A bundled module script runs once per session, so per-page work listens for
 * astro:page-load.
 */
installDisabledGuard();
captureInstallPrompt();
installNavigation();
installCreateEntry();
installDeviceBanners();
installThemeColor();
installUiSound();
// How the last action was started, so motion stays with the pointer: what a key starts happens at
// once (settings.css, player.css, hero.css). Captured, so it is set before the key or the press acts.
const inputBy = (by: string) => (): void => {
  const root = document.documentElement;
  if (root.dataset.input !== by) root.dataset.input = by;
};
// Typing into a text field is not keyboard navigation: a letter in the search pill must not turn the
// keyboard's ring on for a field that was reached with a tap. Tab and Escape still do.
const typesIntoField = (event: KeyboardEvent): boolean =>
  event.key !== "Tab" &&
  event.key !== "Escape" &&
  event.target instanceof HTMLElement &&
  (event.target.isContentEditable ||
    event.target.matches(
      'textarea, input:not([type="checkbox"], [type="radio"], [type="range"], [type="button"], [type="submit"], [type="reset"], [type="file"], [type="color"])',
    ));
const keyboardInput = inputBy("keyboard");
addEventListener(
  "keydown",
  (event) => {
    if (!typesIntoField(event)) keyboardInput();
  },
  { capture: true, passive: true },
);
addEventListener("pointerdown", inputBy("pointer"), { capture: true, passive: true });
// An installed app has no browser chrome to copy an address from, so a long press on its own
// navigation opens no context menu. External story links are not listed and stay copyable.
const IN_APP_NAV =
  ".app-nav-item, .app-nav-create, .app-bar-back, .wordmark, .create-fab, .card-link, .cover-image";
if (matchMedia("(display-mode: standalone)").matches) {
  document.addEventListener("contextmenu", (event) => {
    if (event.target instanceof Element && event.target.closest(IN_APP_NAV)) event.preventDefault();
  });
}
// The service worker registers once the page has loaded, so its code can arrive then too.
const registerWorker = (): void =>
  void import("./serviceWorker").then((worker) => worker.registerServiceWorker());
if (document.readyState === "complete") registerWorker();
else addEventListener("load", registerWorker, { once: true });
// The scrollbar's width, measured while no dialog or open player holds the page: either takes the
// scrollbar away, and the page keeps this much room instead so it does not move (foundations.css,
// player.css). A swap replaces the root's style, so the value goes back on after each one.
let gutter = "0px";
const holdGutter = (): void => document.documentElement.style.setProperty("--gutter", gutter);
const measureGutter = (): void => {
  const held =
    document.querySelector("dialog[open]") || document.documentElement.dataset.player === "open";
  if (!held) gutter = `${Math.max(0, innerWidth - document.documentElement.offsetWidth)}px`;
  holdGutter();
};
measureGutter();
addEventListener("resize", measureGutter, { passive: true });
document.addEventListener("astro:after-swap", holdGutter);
// The launch screen plays once per full load (launch.css), and is hidden once it has, so the copy
// that persists across in-app moves never plays again. A little after its 0.9 seconds.
const launch = document.querySelector<HTMLElement>(".launch");
if (launch) setTimeout(() => (launch.hidden = true), 1200);
// A tab left open across a deploy asks for script files the deploy removed, and the import fails
// (the player's controls, narration). One reload with the saved pages dropped gets the current
// site; the flag stops a second one.
addEventListener("vite:preloadError", () => {
  // Offline, a failed import is the network's doing and a reload would lose the page.
  if (!navigator.onLine) return;
  try {
    if (sessionStorage.getItem("dispatch:reloaded")) return;
    sessionStorage.setItem("dispatch:reloaded", "1");
  } catch {
    return;
  }
  void caches
    ?.keys()
    .then((keys) =>
      Promise.all(keys.filter((key) => /-pages-/.test(key)).map((key) => caches.delete(key))),
    )
    .finally(() => location.reload());
});
// A cover that cannot be fetched (offline, one scrolled to for the first time) shows its palette, not the
// browser's broken-image glyph. An image error does not bubble, so this listens on the way down, and
// covers that failed before this script ran are swept up once.
const hideBroken = (): void => {
  for (const image of document.querySelectorAll<HTMLImageElement>(".cover-image")) {
    if (image.complete && image.naturalWidth === 0) image.hidden = true;
  }
};
document.addEventListener(
  "error",
  (event) => {
    if ((event.target as Element).classList?.contains("cover-image")) {
      (event.target as HTMLImageElement).hidden = true;
    }
  },
  true,
);
document.addEventListener("astro:page-load", hideBroken);
hideBroken();
// The floating Create button is extended until the first scroll, so what folds it waits for one.
addEventListener("scroll", () => void import("./fabScroll").then((fab) => fab.installFabScroll()), {
  once: true,
  passive: true,
});
// What makes a move between destinations immediate is not needed for first paint.
(window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 200)))(() => {
  void import("./navigationBoost").then((boost) => boost.installNavigationBoost());
});
try {
  if (localStorage.getItem("dispatch:deleted-episodes")) void import("./deletedEpisodes");
} catch {
  // Storage can be blocked; nothing is then hidden.
}
