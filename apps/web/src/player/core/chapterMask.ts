/**
 * The mask that cuts the timeline into chapters, as YouTube does: a gap of --scrubber-chapter-gap
 * centred on each story's start after the first. Applied to the track, so the gap shows through the
 * played and the unplayed part alike. Undefined when there is nothing to cut.
 */
export function chapterMask(fractions: readonly number[]): string | undefined {
  const cuts = [...new Set(fractions)]
    .filter((fraction) => fraction > 0 && fraction < 1)
    .sort((a, b) => a - b)
    .map((fraction) => `${(fraction * 100).toFixed(3)}%`);
  if (cuts.length === 0) return undefined;
  const half = "var(--scrubber-chapter-gap) / 2";
  const stops = cuts.flatMap((at) => [
    `#000 calc(${at} - ${half})`,
    `transparent calc(${at} - ${half})`,
    `transparent calc(${at} + ${half})`,
    `#000 calc(${at} + ${half})`,
  ]);
  return `linear-gradient(to right, #000 0, ${stops.join(", ")}, #000 100%)`;
}
