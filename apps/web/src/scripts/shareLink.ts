import { sharedItem, sharedUrl, track } from "../lib/analytics";
import { listenUrl, NOT_STORED_COPY } from "../lib/share";

export type ShareOutcome = "shared" | "copied" | "none";

/** Hands a finished address to the share sheet, or copies it where there is none. */
async function send(title: string, url: string, kind: string, item: string): Promise<ShareOutcome> {
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      track("share", { kind, item, outcome: "shared" });
      return "shared";
    } catch (error) {
      // The reader closed the share sheet: nothing more to do. Any other failure falls back to a copy.
      if (error instanceof Error && error.name === "AbortError") return "none";
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    track("share", { kind, item, outcome: "copied" });
    return "copied";
  } catch {
    // The clipboard is not available here (an insecure origin, a denied permission).
    return "none";
  }
}

/**
 * Share a link: the system share sheet where there is one, a copy to the clipboard where there is
 * not. Returns what happened so the caller can say so ("copied" is the one that needs a word). The
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

/** The items this device made a link for, so their menus offer Stop sharing. Device only. */
const SHARED_KEY = "singularity:shared-items";

function sharedItems(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(SHARED_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function remember(id: string, on: boolean): void {
  const items = sharedItems();
  if (on) items.add(id);
  else items.delete(id);
  try {
    localStorage.setItem(SHARED_KEY, JSON.stringify([...items]));
  } catch {
    // Storage is blocked: Stop sharing is simply not offered on this device.
  }
  syncStopSharing();
}

/**
 * Puts Stop sharing into the menus of the items this device shared, from the template beside each
 * menu's Share, and takes it out of the rest. Not drawn hidden: a menu lists only what it offers.
 */
export function syncStopSharing(): void {
  const items = sharedItems();
  for (const template of document.querySelectorAll<HTMLTemplateElement>(
    "template[data-share-stop-template]",
  )) {
    const button = template.content.querySelector<HTMLElement>("[data-share-stop]");
    const placed = template.nextElementSibling?.matches("[data-share-stop]")
      ? template.nextElementSibling
      : null;
    const wanted = items.has(button?.dataset.shareStop ?? "");
    if (wanted && !placed && button) template.after(button.cloneNode(true));
    if (!wanted) placed?.remove();
  }
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
  const ready = prepared.get(item.id)?.ready;
  const answer = ready !== undefined ? ready : await prepareShare(item.id);
  if (answer === null) return shareLink(item.title, item.path);
  if ("refused" in answer) return answer;
  const outcome = send(item.title, answer.url, item.kind, item.id);
  remember(item.id, true);
  return outcome;
}

/** Stop sharing: every link of the item stops working within the CDN's five minutes. */
export async function stopSharing(id: string): Promise<boolean> {
  try {
    const response = await fetch("/api/share", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item: id }),
    });
    if (!response.ok) return false;
    prepared.delete(id);
    remember(id, false);
    return true;
  } catch {
    return false;
  }
}
