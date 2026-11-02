/**
 * The lengths a Regenerate offers, in minutes (D207), and the one it starts on: the length the
 * podcast aired at, rounded to the nearest offer (a tie goes to the longer one). A podcast airs a little under what was asked
 * (4 min for 5), so the nearest is the one it was made at.
 */
export const REGEN_LENGTHS = [3, 5, 10, 15] as const;
export type RegenLength = (typeof REGEN_LENGTHS)[number];

/** Where a sheet starts when the podcast's length is not known. */
export const DEFAULT_REGEN_LENGTH: RegenLength = 5;

export function nearestRegenLength(minutes: number | string | undefined): RegenLength {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_REGEN_LENGTH;
  return REGEN_LENGTHS.reduce((best, choice) =>
    Math.abs(choice - value) <= Math.abs(best - value) ? choice : best,
  );
}
