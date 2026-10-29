/**
 * Offers to move the schedule to the zone the device is in (D239). The schedule counts its days and
 * its 07:00 in one saved zone for everyone (D100), so a trip moves nothing until the zone is changed;
 * this notices the trip and asks, in the app's toast, and never switches on its own. A dismissal is
 * kept for that device zone and ends once the device and the schedule agree again, so a second trip
 * to the same place asks again and a stay does not nag. A lazy module: loaded at idle and when the
 * app comes back to the front (app.ts), never in a page's first load.
 *
 * The saved zone is the page's as built, with the edits saved since laid over it as a settings page
 * lays them (lib/savedOverlay.ts): this device's own, and the last answer of the config store it
 * holds. Another device's switch reaches this one when the build lands or a Settings page reads the
 * store; until then a stale offer is possible and harmless, since the switch it asks for is the one
 * already saved.
 */
import { scheduleZone, suggestZone } from "@singularity/core/time";
import { SAVED_KEY } from "../lib/savedKey";
import { parseSaved, savedFields, withStore } from "../lib/savedOverlay";
import { cachedStore } from "./configStoreRead";
import type { SaveState } from "./managePageSave";
import { sendToast } from "./toastEvent";

/** The device zones whose offer was closed, kept until the device and the schedule agree. */
export const DISMISSED_KEY = "singularity:zone-dismissed";

/** The zone the schedule counts in, as this device knows it; null on a page built without one. */
export function savedZone(now = Date.now()): string | null {
  const built = document.querySelector<HTMLMetaElement>(
    'meta[name="singularity-timezone"]',
  )?.content;
  if (!built) return null;
  try {
    const entries = parseSaved(localStorage.getItem(SAVED_KEY), now);
    const ops = withStore(entries, cachedStore(), now);
    return scheduleZone(savedFields({ timezone: built }, ops).timezone ?? built);
  } catch {
    return scheduleZone(built);
  }
}

function dismissed(): string[] {
  try {
    const kept: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]");
    return Array.isArray(kept) ? kept.filter((zone) => typeof zone === "string") : [];
  } catch {
    return [];
  }
}

function keep(zones: string[]): void {
  try {
    if (zones.length > 0) localStorage.setItem(DISMISSED_KEY, JSON.stringify(zones));
    else localStorage.removeItem(DISMISSED_KEY);
  } catch {
    // Storage is blocked: the offer comes back with the next visit, which is all it costs.
  }
}

const toastUp = (): boolean => {
  try {
    return document.querySelector(".toast:popover-open") !== null;
  } catch {
    return false;
  }
};

interface Offer {
  zone: string;
  label: string;
  flag?: string;
}

/** A place with its flag when it has one: "Tokyo 🇯🇵". */
const place = (offer: Offer): string => (offer.flag ? `${offer.label} ${offer.flag}` : offer.label);

/**
 * Saves the new zone through the settings pages' own sender (managePageSave.ts), so the server's
 * gap between edits, its refusals and the copies kept for the next page all behave as they do there.
 * Every message of this prompt is short and on one line (a snackbar's words never wrap): a failure
 * says only that it failed and offers Retry, as the server logs the reason under its own reference.
 */
async function switchTo(offer: Offer): Promise<void> {
  const say = (state: SaveState): void => {
    if (state === "saving") return;
    if (state === "error") {
      sendToast({
        message: "Couldn't switch the time zone",
        kind: "error",
        oneLine: true,
        actionLabel: "Retry",
        onAction: () => void switchTo(offer),
      });
      return;
    }
    // "saved", or "done": the zone saved without the fallback run time (managePageSave's
    // TIME_REFUSED), which the hourly cron route reading the zone covers.
    sendToast({ message: `Switched to ${place(offer)}`, kind: "success", oneLine: true });
  };
  try {
    const saver = await import("./managePageSave");
    const pending = {
      op: { op: "schedule.set" as const, timezone: offer.zone },
      el: document.createElement("span"),
      now: offer.zone,
    };
    await saver.flush({
      changes: new Map([["timezone", pending]]),
      show: (_message, state) => say(state),
    });
  } catch {
    say("error");
  }
}

/** Said on the root when a check ends, for a reader of the page that waits on it (the e2e). */
const noteOutcome = (outcome: "agree" | "dismissed" | "offered"): void => {
  document.documentElement.dataset.zonePrompt = outcome;
};

/** Compares the device's zone with the schedule's and offers the switch when they differ. */
export function checkZone(): void {
  if (!navigator.onLine || location.pathname.startsWith("/settings")) return;
  const saved = savedZone();
  if (!saved) return;
  let device: string;
  try {
    device = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return;
  }
  const suggestion = suggestZone(device, saved);
  if (!suggestion) {
    // The clocks agree (or the device's cannot be stood for): the trip is over, and so are its dismissals.
    keep([]);
    noteOutcome("agree");
    return;
  }
  if (dismissed().includes(device)) {
    noteOutcome("dismissed");
    return;
  }
  sendToast(
    {
      message: suggestion.exact
        ? `You're in ${place(suggestion)}`
        : `You're on ${suggestion.label} time`,
      actionLabel: "Switch timezone",
      oneLine: true,
      onAction: () => void switchTo(suggestion),
      onDismiss: () => keep([...new Set([...dismissed(), device])]),
    },
    document,
    { key: "zone", unless: toastUp },
  );
  noteOutcome("offered");
}
