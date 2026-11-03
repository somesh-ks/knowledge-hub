/**
 * Keeps the pages a person expects offline ready (D330): the app's own pages, the Saved list, each
 * saved podcast and the latest ones. A page never opened would otherwise stand in as "Not saved on
 * this device" (pages/offline.astro). The worker does the fetching, gently and at most once an hour
 * per page (public/sw.js, KEEP_READY); this names what to keep: the core pages, the saved podcasts, the Library's newest and the latest. Online only, at idle, and never on a
 * data saver.
 */
import { isOnline } from "../lib/connectivity";
import { SAVED_KEY_PREFIX } from "../player/core/saved";
import { whenIdle } from "./idle";

/** Pages every reader has: Latest, the Library and each Settings page that has no id in its address. */
export const CORE_PAGES = [
  "/",
  "/library",
  "/settings",
  "/settings/saved",
  "/settings/downloads",
  "/settings/daily",
  "/settings/weekly",
  "/settings/categories",
  "/settings/blocked-outlets",
  "/settings/preferences",
  "/settings/voice",
  "/settings/sounds",
  "/settings/notifications",
  "/settings/about",
  "/settings/privacy",
  "/settings/changelog",
] as const;

/** The page of a saved podcast: an episode's id starts with ep-, a briefing's is its date. */
export const pageOf = (id: string): string => (id.startsWith("ep-") ? `/e/${id}` : `/d/${id}`);

/** The ids this device saved (player/core/saved.ts keeps one key per item). */
function savedIds(): string[] {
  try {
    const ids: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(SAVED_KEY_PREFIX)) ids.push(key.slice(SAVED_KEY_PREFIX.length));
    }
    return ids;
  } catch {
    return [];
  }
}

/** How many of the Library's newest podcasts are kept, so the ones a reader is likely to open next work offline. */
const LIBRARY_KEPT = 8;
const LIBRARY_KEY = "singularity:kept-library";

/**
 * The first podcasts of the Library as it was last seen on this device. Read from the page when it
 * is the Library (the rows are in the page), and remembered, so a call from any other page names the
 * same ones and the worker does not forget them.
 */
function libraryPages(): string[] {
  try {
    const rows = [
      ...document.querySelectorAll<HTMLAnchorElement>("[data-library-grid] a.card-link[href]"),
    ]
      .map((link) => link.getAttribute("href") ?? "")
      .filter((href) => /^\/[de]\/[\w-]+$/.test(href))
      .slice(0, LIBRARY_KEPT);
    if (rows.length > 0) localStorage.setItem(LIBRARY_KEY, JSON.stringify(rows));
    const kept: unknown = JSON.parse(localStorage.getItem(LIBRARY_KEY) ?? "[]");
    return Array.isArray(kept)
      ? kept.filter((href): href is string => typeof href === "string")
      : [];
  } catch {
    return [];
  }
}

/** The newest briefing and episode, from the site's own pointer to them; none when it cannot be read. */
async function latestPages(): Promise<string[]> {
  try {
    const response = await fetch("/latest.json");
    if (!response.ok) return [];
    const latest = (await response.json()) as { id?: unknown; episode_id?: unknown };
    return [latest.id, latest.episode_id]
      .filter((id): id is string => typeof id === "string" && id !== "")
      .map(pageOf);
  } catch {
    return [];
  }
}

async function send(force: readonly string[]): Promise<void> {
  if (!isOnline() || !("serviceWorker" in navigator)) return;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    ?.saveData;
  if (saveData) return;
  const registration = await navigator.serviceWorker.ready;
  // Waiting for the worker takes a moment; the connection may have gone in it.
  if (!isOnline()) return;
  const paths = [
    ...CORE_PAGES,
    ...savedIds().map(pageOf),
    ...libraryPages(),
    ...(await latestPages()),
  ];
  registration.active?.postMessage({ type: "KEEP_READY", paths, force });
}

let installed = false;

export function installKeepReady(): void {
  if (installed) return;
  installed = true;
  const ask = (force: readonly string[] = []): void => void send(force).catch(() => undefined);
  whenIdle(() => ask());
  // Arriving at the Library names what it shows now.
  document.addEventListener("astro:page-load", () => {
    if (document.querySelector("[data-library-grid]")) whenIdle(() => ask());
  });
  // A podcast saved or taken out of Saved: it, and the Saved list that shows it, are kept now.
  window.addEventListener("singularity:saved", (event) => {
    const id = (event as CustomEvent<string>).detail;
    ask(typeof id === "string" ? [pageOf(id), "/settings/saved"] : ["/settings/saved"]);
  });
}
