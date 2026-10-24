import type { AnalyticsEvent, AnalyticsMetadata } from "../../lib/analytics";
import type { PlayerStore } from "./playerTypes";

type Track = (name: AnalyticsEvent, metadata?: AnalyticsMetadata) => void;

/**
 * Counts listening for analytics (D154): an item's start, its halfway point while it plays, and
 * its end, each once per item per session, so a pause and resume, a replay or a seek back does not
 * count the same listen twice. The kind (regular, weekly, on-demand) and the item's id go with it,
 * never anything about the listener.
 */
export function countListening(
  store: Pick<PlayerStore, "getState" | "subscribe" | "onSecond" | "onEvent" | "getTime">,
  track: Track,
): () => void {
  const counted = new Set<string>();
  const once = (name: AnalyticsEvent): void => {
    const digest = store.getState().track?.digest;
    if (!digest || counted.has(`${name}:${digest.id}`)) return;
    counted.add(`${name}:${digest.id}`);
    track(name, { kind: digest.kind, item: digest.id });
  };
  const offState = store.subscribe(({ status }) => {
    if (status === "playing") once("listen_start");
  });
  const offSecond = store.onSecond(() => {
    const { status, duration } = store.getState();
    if (status === "playing" && duration > 0 && store.getTime() >= duration / 2) {
      once("listen_half");
    }
  });
  const offEvent = store.onEvent((event) => {
    if (event.type === "ended") once("listen_complete");
  });
  return () => {
    offState();
    offSecond();
    offEvent();
  };
}
