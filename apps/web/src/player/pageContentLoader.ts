import type { ComponentType } from "react";

/**
 * The player page's heavy half (scrubber, transport, speed, the story list) is a separate chunk:
 * none of it is needed to read or to press play. The surface, the bar and the page's shell ship
 * with the island, so opening the player never waits on the network; this chunk is fetched when
 * the browser is idle, again at the first touch on the player, and the page shows a way to try
 * again if it did not arrive.
 *
 * The component lives here, outside React, so a page that mounts once it has loaded renders it in
 * its first pass. React.lazy cannot do that: it suspends on its first render even when its module
 * is cached. One that arrives later renders in a deferred pass (PlayerSurface.tsx).
 */
export interface PageContentSnapshot {
  Content: ComponentType | null;
  status: "idle" | "loading" | "ready" | "failed";
}

let snapshot: PageContentSnapshot = { Content: null, status: "idle" };
let pending: Promise<void> | null = null;
/** Where the chunk lives, learned from the first failure. */
let failedUrl: string | null = null;
const listeners = new Set<() => void>();

/**
 * Chromium remembers a module whose fetch failed and fails every later import of the same URL
 * without asking the network again. Its error names the URL, so a retry asks for the same file
 * under a new query string, which is a module the browser has not given up on. WebKit names no
 * URL and needs none: it fetches again by itself.
 */
function importContent(): Promise<{ default: ComponentType }> {
  if (!failedUrl) return import("./PlayerPageContent");
  const separator = failedUrl.includes("?") ? "&" : "?";
  return import(/* @vite-ignore */ `${failedUrl}${separator}retry=${Date.now()}`);
}

function publish(next: PageContentSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

/** Starts the fetch unless it is under way or done. A failure is forgotten, so the next call tries again. */
export function loadPageContent(): Promise<void> {
  if (snapshot.Content) return Promise.resolve();
  if (pending) return pending;
  publish({ Content: null, status: "loading" });
  pending = importContent().then(
    (module) => {
      publish({ Content: module.default, status: "ready" });
    },
    (error: unknown) => {
      pending = null;
      failedUrl ??= /https?:\/\/\S+/.exec(error instanceof Error ? error.message : "")?.[0] ?? null;
      publish({ Content: null, status: "failed" });
    },
  );
  return pending;
}

export function getPageContent(): PageContentSnapshot {
  return snapshot;
}

const SERVER_SNAPSHOT: PageContentSnapshot = { Content: null, status: "idle" };

export function getServerPageContent(): PageContentSnapshot {
  return SERVER_SNAPSHOT;
}

export function subscribePageContent(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
