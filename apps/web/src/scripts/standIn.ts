/**
 * The stand-in page (pages/offline.astro, D330). The worker answers a page this device never opened
 * with it, at the address that was asked for, so the address bar and the history stay true and the
 * page is only missing. This brings the real one in as soon as the site can be reached:
 *
 *   - by itself, when the connection returns (lib/connectivity.ts confirms it; an unconfirmed return
 *     is asked again with growing gaps, so a premature event cannot strand the page);
 *   - on Try again, which asks now.
 *
 * It moves by the router, replacing the stand-in's own history entry, so the player keeps playing, the
 * scroll and chrome stay, and the route is the one that was asked for, never the Latest page. It lives
 * in the app's script, not the page's: the router swaps the stand-in in without running that page's
 * own script again, which is how recovery was once lost.
 */
import { automaticMove, connectivity } from "../lib/connectivity";

const STAND_IN = "[data-stand-in]";
/** Try again shows it is working for at least this long, so a refusal does not look like a dead button. */
const TRY_MS = 600;

const present = (): boolean => document.querySelector(STAND_IN) !== null;

/** The page the stand-in stands for. At /offline itself (opened by hand) that is the app's first page. */
export function targetOf(location: Pick<Location, "pathname" | "search" | "hash">): string {
  return location.pathname === "/offline"
    ? "/"
    : `${location.pathname}${location.search}${location.hash}`;
}

/** The tab the page belongs to, from its address; the stand-in cannot say it itself (nav is server-drawn). */
export function destinationOf(pathname: string): "today" | "library" | "settings" {
  if (pathname === "/" || pathname === "") return "today";
  if (pathname === "/settings" || pathname.startsWith("/settings/")) return "settings";
  return "library";
}

function markDestination(): void {
  const destination = destinationOf(location.pathname);
  const hrefs = { today: "/", library: "/library", settings: "/settings" } as const;
  for (const link of document.querySelectorAll<HTMLAnchorElement>(".app-nav a[href]")) {
    if (link.matches(".app-nav-brand, .app-nav-create")) continue;
    if (link.getAttribute("href") === hrefs[destination]) link.setAttribute("aria-current", "page");
  }
}

let recovering = false;
/** How many times the connection's return brought the page in by itself and met the stand-in again. */
let autoTries = 0;
/** A page the site cannot give for a reason the connection check does not see stops the loop here. */
const MAX_AUTO_TRIES = 5;

async function recover(): Promise<void> {
  if (recovering || !present()) return;
  recovering = true;
  automaticMove.active = true;
  try {
    const { navigate } = await import("astro:transitions/client");
    await navigate(targetOf(location), { history: "replace" });
  } finally {
    automaticMove.active = false;
    recovering = false;
  }
  // Answered by the stand-in again: the connection was not usable after all. It is asked again on its own.
  if (present()) connectivity().reportUnreachable();
  else autoTries = 0;
}

async function tryAgain(button: HTMLElement): Promise<void> {
  button.setAttribute("aria-busy", "true");
  button.setAttribute("aria-disabled", "true");
  const [link] = await Promise.all([
    connectivity().check(),
    new Promise((resolve) => setTimeout(resolve, TRY_MS)),
  ]);
  button.removeAttribute("aria-busy");
  button.removeAttribute("aria-disabled");
  autoTries = 0;
  if (link === "online") void recover();
}

let installed = false;

export function installStandIn(): void {
  if (installed) return;
  installed = true;
  const link = connectivity();
  const arrive = (): void => {
    if (!present()) return;
    markDestination();
    // Opened by hand at its own address there is nothing it stands for: on to the first page.
    if (location.pathname === "/offline" && link.link() === "online") {
      void recover();
      return;
    }
    // The worker only answers with the stand-in when the network failed, whatever the browser's
    // flag says: take that as true, and confirm the return on the usual gaps.
    if (link.link() === "online") link.reportUnreachable();
    else void link.check();
  };
  document.addEventListener("astro:page-load", arrive);
  link.subscribe((next) => {
    if (next !== "online" || !present() || autoTries >= MAX_AUTO_TRIES) return;
    autoTries += 1;
    void recover();
  });
  // In the capture phase and stopped there: the router also listens for a click on a link, and
  // would move the address to the link's own "#".
  document.addEventListener(
    "click",
    (event) => {
      const button = (event.target as Element | null)?.closest<HTMLElement>(
        `${STAND_IN} [data-retry]`,
      );
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (button.getAttribute("aria-busy") !== "true") void tryAgain(button);
    },
    true,
  );
  arrive();
}
