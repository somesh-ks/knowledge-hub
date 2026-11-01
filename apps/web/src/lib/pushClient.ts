import { cancelTokenOf } from "./cancelTokens";

/**
 * Notifications in this browser (D284): the person switches them on in Settings, and from then on a
 * Catch up or a regeneration started here tells /api/push which browser to message when it ends. The
 * choice is this device's alone, kept in localStorage; the browser's own permission and push
 * subscription are the other halves, so the state shown is all three read together (`notificationState`).
 * Nothing here throws: a run starts the same whether or not the watch could be set.
 */

const KEY = "singularity:notifications";

/** What the person asked to hear about. */
export type Kind = "daily" | "weekly" | "ready";
export const KINDS: readonly Kind[] = ["daily", "weekly", "ready"];
export type Choices = Record<Kind, boolean>;
const NONE: Choices = { daily: false, weekly: false, ready: false };

export type NotificationState =
  /** This browser cannot receive them. The page says so. */
  | "unsupported"
  /** An iPhone or iPad outside the Home Screen app, the only place iOS delivers them. */
  | "needs_install"
  /** The browser's permission was refused: only its own site settings can undo that. */
  | "blocked"
  /** At least one kind is on and the browser will deliver it. */
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
  /** What localStorage says; the person's own switches. */
  chosen: Choices;
}

/** What the page shows, from what the browser can do and what the person chose. */
export function notificationState(c: Capabilities): NotificationState {
  if (!c.supported) return c.apple && !c.standalone ? "needs_install" : "unsupported";
  if (c.permission === "denied") return "blocked";
  return KINDS.some((kind) => c.chosen[kind]) && c.permission === "granted" ? "on" : "off";
}

/** The global switch: all of the kinds on, none, or some (the mixed state). */
export function globalState(chosen: Choices): "on" | "off" | "mixed" {
  const on = KINDS.filter((kind) => chosen[kind]).length;
  return on === 0 ? "off" : on === KINDS.length ? "on" : "mixed";
}

/**
 * The choices after a press. The global switch sets every kind to the state it now shows: pressing it
 * while mixed (the browser flips an unchecked, indeterminate checkbox to checked) turns everything on,
 * and pressing it while all are on turns everything off. A kind's own switch changes only that kind.
 */
export function afterPress(before: Choices, pressed: Kind | "all", checked: boolean): Choices {
  if (pressed === "all") return { daily: checked, weekly: checked, ready: checked };
  return { ...before, [pressed]: checked };
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

export function readChoices(): Choices {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    return {
      daily: record.daily === true,
      weekly: record.weekly === true,
      ready: record.ready === true,
    };
  } catch {
    return { ...NONE };
  }
}

function saveChoices(choices: Choices): void {
  try {
    if (KINDS.some((kind) => choices[kind])) localStorage.setItem(KEY, JSON.stringify(choices));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage is off: the choice cannot be kept, so it reads Off next time.
  }
}

export function readCapabilities(): Capabilities {
  const ua = navigator.userAgent;
  const apple =
    /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
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
    chosen: readChoices(),
  };
}

async function subscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** Asks the browser's permission (from the press that called this, as iOS requires) and subscribes. */
async function ensureSubscribed(): Promise<boolean> {
  try {
    if (
      Notification.permission !== "granted" &&
      (await Notification.requestPermission()) !== "granted"
    ) {
      return false;
    }
    if (await subscription()) return true;
    const response = await fetch("/api/push");
    const { public_key: key } = (await response.json()) as { public_key?: string };
    if (!response.ok || !key) return false;
    const registration = await navigator.serviceWorker.ready;
    await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(key),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Tells the server which scheduled podcasts this browser wants (or that it wants none). True when the
 * server took it; false when it refused (too many devices, a cooldown, the store waking) or was out of reach.
 */
async function syncDevice(choices: Choices): Promise<boolean> {
  try {
    const current = await subscription();
    if (!current) return false;
    const wants = choices.daily || choices.weekly;
    const response = await fetch("/api/push-device", {
      method: wants ? "PUT" : "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        wants
          ? { subscription: current.toJSON(), daily: choices.daily, weekly: choices.weekly }
          : { endpoint: current.endpoint },
      ),
    });
    return response.ok;
  } catch {
    return false;
  }
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Sets which kinds this browser hears about and makes the browser and the server agree: the first
 * kind turned on asks permission and subscribes, the last one turned off drops the subscription.
 * Returns the choices now in force: what was asked for, or what it was before when the browser said no.
 */
export function applyChoices(next: Choices): Promise<Choices> {
  // One change at a time, in the order pressed: a slow request that fails must not undo a later press.
  const run = queue.then(() => applyOne(next));
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function applyOne(next: Choices): Promise<Choices> {
  const before = readChoices();
  if (KINDS.some((kind) => next[kind])) {
    if (!(await ensureSubscribed())) return before;
    saveChoices(next);
    // A Daily or Weekly the server did not register would never be sent: those two go back to what
    // they were. Podcast ready is its own choice and stays.
    if (!(await syncDevice(next)) && (next.daily || next.weekly)) {
      const kept = { ...next, daily: before.daily, weekly: before.weekly };
      saveChoices(kept);
      return kept;
    }
    return next;
  }
  saveChoices(next);
  try {
    const current = await subscription();
    await syncDevice(next);
    await current?.unsubscribe();
  } catch {
    // Already gone, or the browser refused: the choices are off either way.
  }
  return { ...NONE };
}

export type WatchKind = "catch_up" | "regenerate";

/**
 * Asks to be told when run `runId` ends. A no-op unless "Podcast ready" is on here and the run's
 * cancel token is known (the token is the proof that this device started it).
 */
export async function watchRun(
  runId: number,
  kind: WatchKind,
  send: typeof fetch = (input, init) => fetch(input, init),
): Promise<void> {
  try {
    const token = cancelTokenOf(runId);
    const capabilities = readCapabilities();
    if (!token || !capabilities.chosen.ready || notificationState(capabilities) !== "on") return;
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
