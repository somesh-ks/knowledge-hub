import { sharedUrl, track } from "../lib/analytics";
import { listenUrl, NOT_STORED_COPY } from "../lib/share";

export type ShareOutcome = "shared" | "copied" | "none";

/** Hands a finished address to the share sheet, or copies it where there is none. */
async function send(title: string, url: string, kind: string): Promise<ShareOutcome> {
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      track("share", { kind, outcome: "shared" });
      return "shared";
    } catch (error) {
      // The reader closed the share sheet: nothing more to do. Any other failure falls back to a copy.
      if (error instanceof Error && error.name === "AbortError") return "none";
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    track("share", { kind, outcome: "copied" });
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
export async function shareLink(title: string, address: string): Promise<ShareOutcome> {
  const url = sharedUrl(address, location.href);
  const kind = new URL(url).pathname.startsWith("/e/") ? "episode" : "briefing";
  return send(title, url, kind);
}

/** The items this device made a link for, so their menus offer Stop sharing. Device only. */
const SHARED_KEY = "dispatch:shared-items";

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

/** Listen links made on this page, so a second press shares at once (the server reuses it too). */
const made = new Map<string, string>();

/**
 * Share an item as a public listen link (D153): the share route makes or reuses the item's link,
 * and the sheet sends `/s/<token>?ref=share&g=1`. Where the site cannot make one (sharing not set
 * up, the store down, a deployment without the route) it shares the page's own address, as before.
 * An item whose audio is not all stored yet is refused with the route's line, in `refused`.
 */
export async function shareItem(item: {
  id: string;
  title: string;
  path: string;
  kind: "briefing" | "episode";
}): Promise<ShareOutcome | { refused: string }> {
  let url = made.get(item.id) ?? null;
  if (url === null) {
    try {
      const response = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item: item.id }),
      });
      if (response.status === 409) return { refused: NOT_STORED_COPY };
      if (response.ok) {
        const body = (await response.json()) as { token?: unknown };
        if (typeof body.token === "string") {
          url = listenUrl(location.origin, body.token);
          made.set(item.id, url);
          remember(item.id, true);
        }
      }
    } catch {
      // Offline or no route: the page's own address below.
    }
  }
  return url === null ? shareLink(item.title, item.path) : send(item.title, url, item.kind);
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
    made.delete(id);
    remember(id, false);
    return true;
  } catch {
    return false;
  }
}
