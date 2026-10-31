import { cancelTokenOf } from "./cancelTokens";

/**
 * Notifications in this browser (D284): the person switches them on in Settings, and from then on a
 * Catch up or a regeneration started here tells /api/push which browser to message when it ends. The
 * choice is this device's alone, kept in localStorage; the browser's own permission and push
 * subscription are the other halves, so the state shown is all three read together (`notificationState`).
 * Nothing here throws: a run starts the same whether or not the watch could be set.
 */

const KEY = "singularity:notifications";

export type NotificationState =
  /** This browser cannot receive them. The Settings row is hidden. */
  | "unsupported"
  /** An iPhone or iPad outside the Home Screen app, the only place iOS delivers them. */
  | "needs_install"
  /** The browser's permission was refused: only its own site settings can undo that. */
  | "blocked"
  | "on"
  | "off";

export interface Capabilities {
  /** Service worker, Push and Notification all exist. */
  supported: boolean;
  /** iOS or iPadOS Safari. */
  apple: boolean;
  /** Opened from the Home Screen. */
  standalone: boolean;
  permission: NotificationPermission | "none";
  /** What localStorage says; the person's own switch. */
  chosen: boolean;
}

/** What the Settings row shows, from what the browser can do and what the person chose. */
export function notificationState(c: Capabilities): NotificationState {
  if (!c.supported) return c.apple && !c.standalone ? "needs_install" : "unsupported";
  if (c.permission === "denied") return "blocked";
  return c.chosen && c.permission === "granted" ? "on" : "off";
}

/** The VAPID public key as the bytes `pushManager.subscribe` wants. */
export function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const padded = `${key}${"=".repeat((4 - (key.length % 4)) % 4)}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function chosen(): boolean {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

function choose(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "on");
    else localStorage.removeItem(KEY);
  } catch {
    // Storage is off: the switch cannot be kept, so it reads Off next time.
  }
}

export function readCapabilities(): Capabilities {
  const apple =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const supported =
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const standalone =
    matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true;
  return {
    supported,
    apple,
    standalone,
    permission: "Notification" in window ? Notification.permission : "none",
    chosen: chosen(),
  };
}

async function subscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/**
 * Switches notifications on: asks the browser's permission (from the press that called this, as iOS
 * requires), subscribes with the site's key and keeps the choice. The state it ends in; "blocked"
 * when the person said no, "off" when anything else went wrong.
 */
export async function enableNotifications(): Promise<NotificationState> {
  try {
    if ((await Notification.requestPermission()) !== "granted")
      return notificationState(readCapabilities());
    const response = await fetch("/api/push");
    const { public_key: key } = (await response.json()) as { public_key?: string };
    if (!response.ok || !key) return "off";
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    if (!existing) {
      await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(key),
      });
    }
    choose(true);
    return "on";
  } catch {
    return "off";
  }
}

/** Switches them off: drops the subscription, so watches already placed find a dead address. */
export async function disableNotifications(): Promise<void> {
  choose(false);
  try {
    await (await subscription())?.unsubscribe();
  } catch {
    // Already gone, or the browser refused: the choice is off either way.
  }
}

export type WatchKind = "catch_up" | "regenerate";

/**
 * Asks to be told when run `runId` ends. A no-op unless notifications are on here and the run's
 * cancel token is known (the token is the proof that this device started it).
 */
export async function watchRun(
  runId: number,
  kind: WatchKind,
  send: typeof fetch = (input, init) => fetch(input, init),
): Promise<void> {
  try {
    const token = cancelTokenOf(runId);
    if (!token || notificationState(readCapabilities()) !== "on") return;
    const current = await subscription();
    if (!current) return;
    await send("/api/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        run_id: runId,
        cancel_token: token,
        kind,
        subscription: current.toJSON(),
      }),
    });
  } catch {
    // The run is under way either way; only the message is lost.
  }
}
