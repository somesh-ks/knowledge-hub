import { transportGlyph } from "../core/playerCopy";
import type { PlayerState } from "../core/playerTypes";
import Icon from "./Icon";

/**
 * The main transport button's glyph, chosen by `transportGlyph` so it always agrees with the
 * button's name. Play and pause share one slot: the outgoing glyph shrinks, fades and blurs as the
 * incoming one arrives, keyed on the nearest ancestor's `data-playing`, so a button needs no state
 * of its own. Refresh (error) and replay (ended) stand alone in the same slot.
 */
export default function PlayPauseGlyph({ status }: { status: PlayerState["status"] }) {
  const glyph = transportGlyph(status);
  if (glyph === "refresh" || glyph === "replay") {
    return (
      <span className="glyph-swap">
        <Icon name={glyph} />
      </span>
    );
  }
  return (
    <span className="glyph-swap">
      <Icon name="play" className="glyph-paused" />
      <Icon name="pause" className="glyph-playing" />
    </span>
  );
}
