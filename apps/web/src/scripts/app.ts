import { installCreateEntry } from "./createEntry";
import { installDeviceBanners } from "./deviceBanners";
import { installDisabledGuard } from "./disabledGuard";
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
installNavigation();
installCreateEntry();
installDeviceBanners();
installThemeColor();
installUiSound();
// The service worker registers once the page has loaded, so its code can arrive then too.
const registerWorker = (): void =>
  void import("./serviceWorker").then((worker) => worker.registerServiceWorker());
if (document.readyState === "complete") registerWorker();
else addEventListener("load", registerWorker, { once: true });
// The scrollbar's width, measured while no dialog holds the page: an open dialog takes the
// scrollbar away, and the page keeps this much room instead so it does not move (foundations.css).
// A swap replaces the root's style, so the value goes back on after each one.
let gutter = "0px";
const holdGutter = (): void => document.documentElement.style.setProperty("--gutter", gutter);
const measureGutter = (): void => {
  if (!document.querySelector("dialog[open]"))
    gutter = `${Math.max(0, innerWidth - document.documentElement.offsetWidth)}px`;
  holdGutter();
};
measureGutter();
addEventListener("resize", measureGutter, { passive: true });
document.addEventListener("astro:after-swap", holdGutter);
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
