/**
 * The reader coupling's pure parts: where the rail fill sits, which node a tap means, which item a
 * button belongs to and what the call to action says. Kept free of the DOM so they can be tested.
 */
import type { PlayerDigestData } from "../../types/contracts";
import { formatClock } from "./formatTime";
import { clamp, lerp } from "./mathUtils";
import type { PlayerState } from "./playerTypes";
import { fractionWithinItem, type Timeline } from "./timeline";

/**
 * Fill position of the rail as a 0 to 1 fraction of its height. Piecewise linear between item node
 * centers, by time: for playhead t inside item i, y = lerp(node[i], node[i + 1], progress through
 * the item), and the last item ends at the bottom of the briefing. This is why the rail fills
 * continuously inside an item instead of in steps (design-spec.md, The rail).
 */
export function railProgress(
  nodeY: readonly (number | undefined)[],
  totalHeight: number,
  timeline: Timeline | null,
  itemIndex: number,
  timeSeconds: number,
  ended: boolean,
): number {
  if (ended) return 1;
  const item = timeline?.items[itemIndex];
  const start = nodeY[itemIndex];
  if (!timeline || !item || start === undefined || totalHeight <= 0) return 0;
  const end = nodeY[itemIndex + 1] ?? totalHeight;
  const y = lerp(start, end, fractionWithinItem(item, timeSeconds));
  return clamp(y / totalHeight, 0, 1);
}

/** The node nearest a tap on the rail strip. The strip is one flush target, so gaps are live. */
export function nearestNodeIndex(nodeY: readonly (number | undefined)[], tapY: number): number {
  let nearest = -1;
  let best = Number.POSITIVE_INFINITY;
  nodeY.forEach((y, index) => {
    if (y === undefined) return;
    const distance = Math.abs(y - tapY);
    if (distance < best) {
      best = distance;
      nearest = index;
    }
  });
  return nearest;
}

export type ItemVisualState = "played" | "current" | "";

/** `data-state` for an item, given the live item index. Absent means upcoming. */
export function itemVisualState(
  index: number,
  live: boolean,
  currentIndex: number,
  ended: boolean,
): ItemVisualState {
  if (!live) return "";
  if (ended) return "played";
  if (index < currentIndex) return "played";
  return index === currentIndex ? "current" : "";
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

export interface CtaView {
  label: string;
  /** "3:32" before playback, "1:26 of 3:32" after. Empty when there is nothing to show. */
  clock: string;
  playing: boolean;
  loading: boolean;
}

/**
 * The hero button's face for a state (design-spec.md, Reader hero). While the first 300 ms of
 * buffering run, the label stays "Pause": the listener asked for playback, and swapping the label
 * twice inside a frame or two reads as a flicker.
 */
export function ctaView(
  state: PlayerState,
  timeSeconds: number,
  pageDigest: PlayerDigestData | null,
): CtaView {
  const duration = (pageDigest?.audio?.duration_ms ?? 0) / 1000;
  const isPageTrack = state.digestId !== null && state.digestId === pageDigest?.id;
  if (!isPageTrack || state.status === "idle") {
    const resumable = isPageTrack && timeSeconds > 0;
    return {
      label: resumable ? "Resume" : "Play the briefing",
      clock: resumable
        ? `${formatClock(timeSeconds)} of ${formatClock(state.duration || duration)}`
        : formatClock(duration),
      playing: false,
      loading: false,
    };
  }
  const total = state.duration || duration;
  const clock = `${formatClock(timeSeconds)} of ${formatClock(total)}`;
  switch (state.status) {
    case "playing":
      return { label: "Pause", clock, playing: true, loading: false };
    case "loading":
      return {
        label: state.buffering ? "Preparing audio" : "Pause",
        clock,
        playing: true,
        loading: state.buffering,
      };
    case "paused":
      return { label: "Resume", clock, playing: false, loading: false };
    case "ended":
      return { label: "Play again", clock: formatClock(total), playing: false, loading: false };
    case "error":
      return { label: "Try again", clock, playing: false, loading: false };
  }
}
