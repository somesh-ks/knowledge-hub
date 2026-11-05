import { sharedItem, sharedUrl, track } from "../lib/analytics";
import { isOnline } from "../lib/connectivity";
import { listenUrl, NOT_STORED_COPY } from "../lib/share";
import { whenIdle } from "./idle";
import { openShareDialog } from "./shareDialog";

export type ShareOutcome = "shared" | "copied" | "none";

/** A finger is the main pointer and the browser can open the system's own share sheet. */
function hasSystemSheet(url: string, title: string): boolean {
  if (typeof navigator.share !== "function") return false;
  if (!window.matchMedia("(pointer: coarse)").matches) return false;
  return navigator.canShare ? navigator.canShare({ title, url }) : true;
}

/**
 * Sends a finished address: through the phone's own share sheet where there is one (Android, iPhone,
 * iPad), else the small dialog with the address and a Copy link button (shareDialog.ts), which says
 * its own "Copied". The sheet is called first and without an await before it, so it opens inside
 * the press (iOS refuses one opened later). Counted when the link was sent or copied.
 */
async function send(title: string, url: string, kind: string, item: string): Promise<ShareOutcome> {
  if (hasSystemSheet(url, title)) {
    try {
      await navigator.share({ title, url });
      track("share", { kind, item, outcome: "shared" });
      return "shared";
    } catch (error) {
      // The reader closed the sheet: nothing was sent. Any other refusal falls through to the dialog.
      if (error instanceof DOMException && error.name === "AbortError") return "none";
    }
  }
  const outcome = await openShareDialog(title, url);
  if (outcome === "copied") track("share", { kind, item, outcome });
  return outcome;
}

/**
 * Share a link: a small dialog with the address and a Copy link button (shareDialog.ts), which says
 * its own "Copied". Returns what happened once it closes. The
 * link carries `ref=share`, so the visit it brings is counted as a share's (D154).
 */
export async function shareLink(
  title: string,
  address: string,
  about?: { kind: "briefing" | "episode"; item: string },
): Promise<ShareOutcome> {
  const url = sharedUrl(address, location.href);
  const { kind, item } = about ?? sharedItem(url);
  return send(title, url, kind, item);
}

/** A listen link ready to share, the route's refusal, or null where the site cannot make one. */
type Prepared = { url: string } | { refused: string } | null;

/**
 * How long a prepared link is trusted. A menu opened later asks the route again, which answers the
 * same link, or a new one when it was stopped, expired or its item was regenerated (a 410 link is
 * never shared from here for longer than this).
 */
const PREPARED_MS = 30_000;

/** Links asked for on this page: the pending answer, and the answer once it came. */
const prepared = new Map<string, { at: number; pending: Promise<Prepared>; ready?: Prepared }>();

/**
 * The last link the route gave for each item, kept past PREPARED_MS for a press that would otherwise
 * wait: iOS opens no share sheet after an awaited request, so a slightly old link shared at once
 * beats a fresh one shared never. A press still asks again in the background, for the next one.
 */
const LINK_KEPT_MS = 10 * 60_000;
const known = new Map<string, { url: string; at: number }>();

async function askForLink(id: string): Promise<Prepared> {
  try {
    const response = await fetch("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item: id }),
    });
    if (response.status === 409) return { refused: NOT_STORED_COPY };
    if (!response.ok) return null;
    const body = (await response.json()) as { token?: unknown };
    if (typeof body.token !== "string") return null;
    return { url: listenUrl(location.origin, body.token) };
  } catch {
    // Offline or no route: the page's own address is shared instead.
    return null;
  }
}

/**
 * Asks for the item's listen link ahead of the press, when its menu opens: the share sheet must
 * open inside the tap itself (iOS refuses one opened after an awaited request).
 */
export function prepareShare(id: string): Promise<Prepared> {
  const held = prepared.get(id);
  if (held && Date.now() - held.at < PREPARED_MS) return held.pending;
  const entry: { at: number; pending: Promise<Prepared>; ready?: Prepared } = {
    at: Date.now(),
    pending: Promise.resolve(null),
  };
  entry.pending = askForLink(id).then((answer) => {
    entry.ready = answer;
    if (answer && "url" in answer) known.set(id, { url: answer.url, at: Date.now() });
    else if (answer) known.delete(id);
    // A failed ask is not kept: the next menu asks again.
    if (answer === null && prepared.get(id) === entry) prepared.delete(id);
    return answer;
  });
  prepared.set(id, entry);
  return entry.pending;
}

// A menu holding a listen Share asks for its link as it opens; a press on Share asks too, for a
// menu opened another way. toggle events do not bubble, so they are caught on the way down.
if (typeof document !== "undefined") {
  const prepareWithin = (node: EventTarget | null): void => {
    if (!(node instanceof Element)) return;
    const share = node.matches("[data-share-item]")
      ? node
      : node.querySelector<HTMLElement>("[data-share-item]");
    const id = share?.getAttribute("data-share-item");
    if (id) void prepareShare(id);
  };
  document.addEventListener(
    "beforetoggle",
    (event) => {
      if ((event as ToggleEvent).newState === "open") prepareWithin(event.target);
    },
    true,
  );
  document.addEventListener(
    "pointerdown",
    (event) => prepareWithin((event.target as Element).closest?.("[data-share-item]") ?? null),
    true,
  );
}

/**
 * Share beside Play (data-share-early) asks for its link once the page is idle, and again when the
 * page comes back into view after the kept link has aged: on iOS the first tap otherwise reached the
 * sheet only after the request, and the sheet did not open. One indexed read once the link exists.
 */
export function prepareEarly(): void {
  const id = document.querySelector<HTMLElement>("[data-share-early]")?.dataset.shareItem;
  // Offline there is no link to get, and a failed ask only logs an error: the press asks again.
  if (id)
    whenIdle(() => {
      if (isOnline()) void prepareShare(id);
    });
}

if (typeof document !== "undefined")
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") prepareEarly();
  });

/**
 * Share an item as a public listen link (D153): the share route makes or reuses the item's link,
 * and the sheet sends `/s/<token>?ref=share&g=1`. A link prepared when the menu opened is shared at
 * once, inside the press. Where the site cannot make one (no database, the store down, a
 * deployment without the route) it shares the page's own address, as before. An item whose audio
 * is not all stored yet is refused with the route's line, in `refused`.
 */
export async function shareItem(item: {
  id: string;
  title: string;
  path: string;
  kind: "briefing" | "episode";
}): Promise<ShareOutcome | { refused: string }> {
  // An answer older than PREPARED_MS is asked again: the link may have stopped, or the audio landed.
  const held = prepared.get(item.id);
  const kept = known.get(item.id);
  const ready =
    held && Date.now() - held.at < PREPARED_MS && held.ready !== undefined
      ? held.ready
      : kept && Date.now() - kept.at < LINK_KEPT_MS
        ? { url: kept.url }
        : undefined;
  const answer = ready !== undefined ? ready : await prepareShare(item.id);
  if (answer === null) return shareLink(item.title, item.path);
  if ("refused" in answer) return answer;
  return send(item.title, answer.url, item.kind, item.id);
}
