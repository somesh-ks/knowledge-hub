import Icon from "./Icon";

/**
 * Play and pause share one slot: the outgoing glyph shrinks, fades and blurs as the incoming one
 * arrives. Keyed on the nearest ancestor's `data-playing`, so a button needs no state of its own.
 */
export default function PlayPauseGlyph() {
  return (
    <span className="glyph-swap">
      <Icon name="play" className="glyph-paused" />
      <Icon name="pause" className="glyph-playing" />
    </span>
  );
}
