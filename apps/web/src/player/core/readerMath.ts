/**
 * The reader coupling's pure parts: which item a button belongs to, and what each play chip shows
 * and is called in every state. Kept free of the DOM so they can be tested, and free of anything
 * that only runs in a browser, so the pages render the same idle chips at build time.
 */
import type { PlayerDigestData } from "../../types/contracts";
import { formatClock } from "./formatTime";
import type { PlayerState } from "./playerTypes";

export type ItemVisualState = "played" | "current" | "";

/**
 * `data-state` for an item, given the live item index. Absent means upcoming. A story is played when
 * the playhead has passed it in this run of listening: the ones before `runStart` were stepped over.
 */
export function itemVisualState(
  index: number,
  live: boolean,
  currentIndex: number,
  ended: boolean,
  runStart = 0,
): ItemVisualState {
  if (!live) return "";
  if (ended || index < currentIndex) return index >= runStart ? "played" : "";
  return index === currentIndex ? "current" : "";
}

/**
 * Where the stories heard in this run begin after the playhead moved from story `from` to story
 * `to`. A move that steps over whole stories (a tap on Play from here, a scrub or a seek past one)
 * starts a new run there: what it stepped over was not heard. A step to the next story keeps the run,
 * and a move back pulls its start back with it.
 */
export function runStartAfter(runStart: number, from: number, to: number): number {
  if (to > from + 1) return to;
  return Math.min(runStart, Math.max(0, to));
}

/**
 * A play button names its item by id, by index, or by sitting inside the item. The page author
 * owns the markup, so all three are accepted.
 */
export function resolveItemId(
  attributeValue: string | undefined,
  digest: PlayerDigestData | null,
  enclosingItemId: string | undefined,
): string | null {
  if (!digest) return null;
  if (attributeValue) {
    if (digest.items.some((item) => item.id === attributeValue)) return attributeValue;
    const index = Number(attributeValue);
    if (Number.isInteger(index)) return digest.items[index]?.id ?? null;
  }
  if (enclosingItemId && digest.items.some((item) => item.id === enclosingItemId)) {
    return enclosingItemId;
  }
  return null;
}

/** A chapter control names its section by slug or by the index of its first item. */
export function resolveChapterFirstItemId(
  attributeValue: string | undefined,
  digest: PlayerDigestData | null,
): string | null {
  if (!digest || !attributeValue) return null;
  const bySlug = digest.items.find((item) => item.section === attributeValue);
  if (bySlug) return bySlug.id;
  const index = Number(attributeValue);
  return Number.isInteger(index) ? (digest.items[index]?.id ?? null) : null;
}

/* ------------------------------------------------------------------ play chips */

/**
 * What a play chip shows. `state` and `playing` go to data-state and data-playing, `label` is the
 * visible text and `name` the accessible name. The name always says the action and always contains
 * the visible text, so a voice command that reads the chip finds it.
 */
export interface ChipView {
  state: "idle" | "current" | "played" | "preparing";
  playing: boolean;
  label: string;
  name: string;
}

/** "8 min" for a whole recording: whole minutes, never less than one. */
export function briefingLengthLabel(durationMs: number): string {
  return `${wholeMinutes(durationMs)} min`;
}

/** Minutes to the nearest whole one, never less than one: the one rule for a length and a time left. */
function wholeMinutes(durationMs: number): number {
  return Math.max(1, Math.round(durationMs / 60_000));
}

/** "0:24" for one story's share of the recording, or "" when it has no marks. */
export function storyLengthLabel(startMs: number | null, endMs: number | null): string {
  if (startMs === null || endMs === null) return "";
  return formatClock(Math.round((endMs - startMs) / 1000));
}

/** What the page's chip plays, in its accessible name: an episode page calls it an episode. */
export type ChipNoun = "briefing" | "episode";

/**
 * The bar holds the audio of the page `digestId` names: something has played this session, so the
 * bar shows, and what it holds is that page's. The bar is then the page's play control, and the
 * floating Play button steps aside.
 */
export function barHolds(
  state: Pick<PlayerState, "hasStarted" | "digestId">,
  digestId: string | undefined,
): boolean {
  return state.hasStarted && state.digestId === digestId;
}

/** The briefing's chip before anything has played. The pages render this one at build time. */
export function idleBriefingChip(length: string, noun: ChipNoun = "briefing"): ChipView {
  return { state: "idle", playing: false, label: length, name: `Play the ${noun}, ${length}` };
}

/** A story's chip before it has played. `length` is empty while the briefing has no audio. */
export function idleStoryChip(length: string, headline: string): ChipView {
  const action = length ? `Play from here, ${length}` : "Play from here";
  return { state: "idle", playing: false, label: length, name: `${action}: ${headline}` };
}

/**
 * The briefing's chip for a player state. While the first 300 ms of buffering run it already shows
 * the playing face: the listener asked for playback, and a label that changes twice inside a few
 * frames reads as a flicker.
 */
export function briefingChipView(
  state: PlayerState,
  timeSeconds: number,
  pageDigest: PlayerDigestData,
  noun: ChipNoun = "briefing",
): ChipView {
  const pageDurationMs = pageDigest.audio?.duration_ms ?? 0;
  // Another briefing is loaded: this chip starts its own from the top.
  if (state.digestId !== pageDigest.id) {
    return idleBriefingChip(briefingLengthLabel(pageDurationMs), noun);
  }

  // Once the audio has loaded, its real length is the one every control says.
  const total = state.duration || pageDurationMs / 1000;
  const idle = idleBriefingChip(briefingLengthLabel(total * 1000), noun);
  // The same rounding as the length, so 2:10 is "2 min" long with "2 min left" at its start.
  const left = `${wholeMinutes(Math.max(0, total - timeSeconds) * 1000)} min left`;
  const resume = { playing: false, label: left, name: `Resume the ${noun}, ${left}` };
  // Playing, the chip is the pause button and says what is left, as a podcast app's does; the
  // moving bars belong to the story chips (hero.css shows the pause glyph here).
  const playing: ChipView = {
    state: "current",
    playing: true,
    label: left,
    name: `Pause the ${noun}, ${left}`,
  };
  switch (state.status) {
    case "idle":
      // A remembered position is offered, but nothing is loaded into the ear yet.
      return timeSeconds > 0 ? { state: "idle", ...resume } : idle;
    case "playing":
      return playing;
    case "loading":
      return state.buffering
        ? {
            state: "preparing",
            playing: true,
            label: "Loading",
            name: `Pause the ${noun}, loading`,
          }
        : playing;
    case "paused":
      return { state: "current", ...resume };
    case "ended":
      return {
        state: "played",
        playing: false,
        label: "Played",
        name: `Play the ${noun} again, played`,
      };
    case "error":
      return { state: "idle", playing: false, label: "Try again", name: "Try again" };
  }
}

/** A story's chip, from where the playhead is relative to it. */
export function storyChipView(
  visual: ItemVisualState,
  playing: boolean,
  buffering: boolean,
  length: string,
  headline: string,
): ChipView {
  if (visual === "played") {
    return {
      state: "played",
      playing: false,
      label: "Played",
      name: `Play again, played: ${headline}`,
    };
  }
  if (visual !== "current") return idleStoryChip(length, headline);
  if (playing && buffering) {
    return {
      state: "preparing",
      playing: true,
      label: "Loading",
      name: `Pause, loading: ${headline}`,
    };
  }
  return playing
    ? { state: "current", playing: true, label: "Playing", name: `Pause, playing: ${headline}` }
    : { state: "current", playing: false, label: "Paused", name: `Resume, paused: ${headline}` };
}
