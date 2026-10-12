import type { PlayerEvent, Track } from "./playerTypes";
import { itemPositionLabel } from "./timeline";

/**
 * What a screen reader hears for each player event (design-spec.md, Screen-reader announcement
 * plan). Automatic advance, keyboard seeks and scrubbing announce nothing here: the narrator is
 * already speaking, and the scrubber's aria-valuetext carries position for keyboard users.
 */
export interface AnnouncementContext {
  /**
   * The open player is on screen. Its notice (role alert or status) then speaks errors and
   * interruptions itself, so the live region says nothing to avoid saying it twice.
   */
  open: boolean;
  /** Playback has been asked for. Before that a failure (a file found missing) is not the listener's news. */
  started?: boolean;
}

export function announcementForEvent(
  event: PlayerEvent,
  track: Track | null,
  context: AnnouncementContext = { open: false },
): string | null {
  switch (event.type) {
    case "willPlay":
      return event.reason === "user" ? "Playing." : null;
    case "didPause":
      return event.reason === "user" ? "Paused." : null;
    case "itemChanged": {
      const chosen =
        event.cause === "skip-next" || event.cause === "skip-previous" || event.cause === "select";
      if (!chosen) return null;
      if (event.index < 0) return "Back to the start.";
      const item = track?.timeline?.items[event.index];
      if (!item) return null;
      return `${itemPositionLabel(track?.timeline ?? null, event.index)}: ${item.headline}`;
    }
    // The slider's value text and the pressed preset already say the speed.
    case "rateChanged":
      return null;
    case "ended":
      return track?.digest.turns ? "Episode finished." : "Briefing finished.";
    case "interrupted":
      return context.open ? null : "Paused by another app.";
    case "error":
      return context.open || context.started === false ? null : event.error.message;
    case "loaded":
      return null;
  }
}

interface Region {
  textContent: string | null;
}

export interface Announcer {
  announce(message: string): void;
}

/**
 * Two polite regions used alternately and cleared before reuse. A single region updated twice in
 * one frame announces once; two regions mean every message is observed.
 */
export function createAnnouncer(
  getRegions: () => readonly [Region, Region],
  schedule: (callback: () => void, delayMs: number) => unknown = (callback, delayMs) =>
    setTimeout(callback, delayMs),
): Announcer {
  let turn = 0;
  return {
    announce(message) {
      const regions = getRegions();
      const region = regions[turn % 2];
      turn += 1;
      if (!region) return;
      region.textContent = "";
      // The change must land after the clear for the browser to treat it as new content.
      schedule(() => {
        region.textContent = message;
      }, 50);
    },
  };
}
