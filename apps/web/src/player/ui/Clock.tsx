import { clockParts, clockSizerParts, remainingSign } from "../core/formatTime";

interface ClockProps {
  seconds: number;
  /** A minus sign before the time, for time remaining (none at 0:00). */
  negative?: boolean;
  /**
   * Holds the width of the widest time up to this many seconds, so what follows the clock does not
   * move when the time gains a digit (9:59 to 10:00).
   */
  widest?: number;
}

/**
 * A live clock. Tabular figures widen the colon too, so it sits in a narrow fixed box and the
 * digits never shift while the time changes.
 */
export default function Clock({ seconds, negative = false, widest }: ClockProps) {
  const sign = negative ? remainingSign(seconds) : "";
  const face = ({ before, after }: { before: string; after: string }) => (
    <>
      {sign}
      {before}
      <span className="player-colon">:</span>
      {after}
    </>
  );
  if (widest === undefined) return <span className="num">{face(clockParts(seconds))}</span>;
  return (
    <span className="num clock-held">
      <span>{face(clockParts(seconds))}</span>
      <span className="clock-sizer" aria-hidden="true">
        {face(clockSizerParts(widest))}
      </span>
    </span>
  );
}
