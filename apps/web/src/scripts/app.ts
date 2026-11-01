import { installRipple } from "../design-system/ripple";
import { counted, installAnalytics } from "../lib/analytics";
import { watchPlatformFaults } from "../lib/platformFaults";
import { hasOutbox } from "../lib/savedKey";
import { loadOtherBuildsInFull } from "./buildGuard";
import { installCoverMorph } from "./coverMorph";
import { installCreateEntry } from "./createEntry";
import { installDeviceBanners } from "./deviceBanners";
import { installDisabledGuard } from "./disabledGuard";
import { captureInstallPrompt } from "./installPrompt";
import { installIslandWake } from "./islandWake";
import { installNavigation } from "./navigation";
import { installPersistedMotion } from "./persistedMotion";
import { installQueueEntry } from "./queueEntry";
import { installRootState } from "./rootState";
import { installThemeColor } from "./themeColor";
import { trackTyping } from "./typing";
import { installUiSound } from "./uiSound";

/**
 * Page-level behavior that belongs to the shell, not to the player: navigation rules, device
 * banners, the disabled-control guard, the browser chrome colour, the root's dialog and toast state,
 * the service worker, the analytics script (production only, D154) and the wake of the islands. Loaded once from the layout.
 * A bundled module script runs once per session, so per-page work listens for astro:page-load.
 */
installDisabledGuard();
// From the first moment: the update check starts after load and must know what was typed before it.
trackTyping();
captureInstallPrompt();
installNavigation();
installPersistedMotion();
installCoverMorph();
installRipple();
installRootState();
installCreateEntry();
installQueueEntry();
installDeviceBanners();
installThemeColor();
installUiSound();
installAnalytics();
installIslandWake();
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
// The build this bundle loaded with, read once: in-app moves swap the head's meta for the new
// page's while this bundle keeps running (the fault reports and the update check both need the old name).
const build = document.querySelector<HTMLMetaElement>('meta[name="singularity-build"]')?.content;
loadOtherBuildsInFull(build);
// The service worker registers once the page has loaded, so its code can arrive then too.
const registerWorker = (): void =>
  void import("./serviceWorker").then((worker) => worker.registerServiceWorker(build));
if (document.readyState === "complete") registerWorker();
else addEventListener("load", registerWorker, { once: true });
// The scrollbar's width, measured while no dialog or open player holds the page: either takes the
// scrollbar away, and the page keeps this much room instead so it does not move (foundations.css,
// player.css). A swap replaces the root's style, so the value goes back on after each one. No
// scrollbar (a phone) leaves the property unset, which every use reads as 0px: a custom property
// set on the root restyles the whole page, about 50 ms of a throttled phone's first load.
let gutter = "0px";
const holdGutter = (): void => {
  const root = document.documentElement.style;
  if (gutter === "0px") root.removeProperty("--gutter");
  else root.setProperty("--gutter", gutter);
};
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
// Uncaught errors and policy violations go to /api/report (server/report.ts), at most five a page
// load, so a fault on a phone reaches the function log and the week's store instead of vanishing.
// The build goes with it (D158), read once above.
// Kept a few hundred bytes: it is on every page's first load.
let reports = 0;
const report = (fault: object): void => {
  if (reports++ < 5)
    navigator.sendBeacon?.(
      "/api/report",
      JSON.stringify({
        ...fault,
        page: location.pathname,
        build,
      }),
    );
};
addEventListener("error", (event) =>
  report({ kind: "error", message: event.message, source: event.filename, line: event.lineno }),
);
// A function Vercel killed answers with its own 5xx, which only the page sees (lib/platformFaults.ts).
watchPlatformFaults(window, location.origin, report);
addEventListener("unhandledrejection", (event) =>
  report({ kind: "rejection", message: String(event.reason?.message ?? event.reason) }),
);
// Code that is not on the web (a headless browser's injected style, an extension) is not the
// site's fault, and each report is a function run; the server drops it too (server/report.ts).
document.addEventListener("securitypolicyviolation", (event) => {
  if (event.sourceFile && !/^https?:/.test(event.sourceFile)) return;
  report({
    kind: "csp",
    directive: event.effectiveDirective,
    blocked: event.blockedURI,
    source: event.sourceFile,
    line: event.lineNumber,
  });
});
// A tab left open across a deploy asks for script files the deploy removed, and the import fails
// (the player's controls, narration). One reload with the saved pages dropped gets the current
// site; the flag stops a second one.
addEventListener("vite:preloadError", () => {
  // Offline, a failed import is the network's doing and a reload would lose the page.
  if (!navigator.onLine) return;
  try {
    if (sessionStorage.getItem("singularity:reloaded")) return;
    sessionStorage.setItem("singularity:reloaded", "1");
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
const idle = window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 200));
// What makes a move between destinations immediate is not needed for first paint.
idle(() => {
  void import("./navigationBoost").then((boost) => boost.installNavigationBoost());
});
// The schedule's time zone against the device's (D239): a lazy module offers the switch when they
// differ, at idle on each page (the check skips Settings, so a move off it asks) and whenever the app
// comes back to the front, which is when a trip shows. Offline the import is left alone (Chromium
// remembers a failed one, as navigationBoost's note says).
const zone = (): void => {
  if (navigator.onLine) void import("./zonePrompt").then((prompt) => prompt.checkZone());
};
idle(zone);
// The first astro:page-load is the load just checked; every later one is a page replaced or entered.
let firstPage = true;
document.addEventListener("astro:page-load", () => {
  if (firstPage) firstPage = false;
  else idle(zone);
});
addEventListener("online", zone);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") zone();
});
// Settings edits kept on this device while the site could not be reached (CFG-04) go out as soon as it
// can: on each page that loads online and when the connection returns. Nothing loads without a kept edit.
const outbox = (): void => {
  if (navigator.onLine && hasOutbox())
    void import("./managePageSave").then((save) => save.drainOutbox()).catch(() => {});
};
document.addEventListener("astro:page-load", outbox);
addEventListener("online", outbox);
// Field Web Vitals (D156), with the analytics opt-outs (the production host, no Do Not Track or
// Global Privacy Control): a lazy module measures this page load and sends it once when the page is
// first hidden. It loads at idle, or at the first visibility change if that comes sooner (a reader
// who leaves at once), so the first load carries only these lines.
if (counted()) {
  const vitals = (): void => void import("./vitals").then((each) => each.startVitals());
  idle(vitals);
  document.addEventListener("visibilitychange", vitals, { once: true });
}
try {
  if (localStorage.getItem("singularity:deleted-episodes")) void import("./deletedEpisodes");
} catch {
  // Storage can be blocked; nothing is then hidden.
}
