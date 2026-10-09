/**
 * How many stories a scheduled briefing keeps for the length the owner chose. A ten minute
 * podcast is the digest as the engine has always written it (the full cap); a shorter one keeps a
 * share of that cap, never fewer than the floor below which nothing publishes, and a longer one
 * cannot exceed the digest's hard cap.
 */
export function capForLength(baseCap: number, floor: number, minutes: number): number {
  const scaled = Math.round((baseCap * minutes) / 10);
  return Math.max(floor, Math.min(baseCap, scaled));
}
