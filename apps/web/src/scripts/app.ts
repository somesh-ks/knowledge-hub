import { installCreateEntry } from "./createEntry";
import { installDeviceBanners } from "./deviceBanners";
import { installDisabledGuard } from "./disabledGuard";
import { installNavigation } from "./navigation";
import { registerServiceWorker } from "./serviceWorker";
import { installThemeColor } from "./themeColor";

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
registerServiceWorker();
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
// What makes a move between destinations immediate is not needed for first paint.
(window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 200)))(() => {
  void import("./navigationBoost").then((boost) => boost.installNavigationBoost());
});
try {
  if (localStorage.getItem("dispatch:deleted-episodes")) void import("./deletedEpisodes");
} catch {
  // Storage can be blocked; nothing is then hidden.
}
