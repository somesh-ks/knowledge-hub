import { clockParts } from "../core/formatTime";

interface ClockProps {
  seconds: number;
  /** A minus sign before the time, for time remaining. */
  negative?: boolean;
}

/**
 * A live clock. Tabular figures widen the colon too, so it sits in a narrow fixed box and the
 * digits never shift while the time changes.
 */
export default function Clock({ seconds, negative = false }: ClockProps) {
  const { before, after } = clockParts(seconds);
  return (
    <span className="num">
      {negative ? "-" : ""}
      {before}
      <span className="player-colon">:</span>
      {after}
    </span>
  );
}
