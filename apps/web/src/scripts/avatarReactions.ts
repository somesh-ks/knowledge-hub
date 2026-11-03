/** What a tap on the avatar does, as pure choices (D353): accountAvatar.ts plays them. */
const HUE_BANDS = 6;

/** The reaction a tap plays: the list of the mood, started by the band of the hue and stepping on with every tap. */
export function pickReaction(plays: string[], hue: number, taps: number): string {
  if (plays.length === 0) return "hop";
  const band = Math.floor((((hue % 360) + 360) % 360) / (360 / HUE_BANDS));
  return plays[(band + taps) % plays.length] ?? "hop";
}

/** The shapes a morph passes through before it comes home: up to two others, picked as a tap picks. */
export function morphPath(offered: string[], home: string, hue: number, taps: number): string[] {
  const others = offered.filter((id) => id !== home);
  const band = Math.floor((((hue % 360) + 360) % 360) / (360 / HUE_BANDS));
  const first = others[(band + taps) % others.length];
  const second = others[(band + taps + 2) % others.length];
  const path = first ? [first] : [];
  if (second && second !== first) path.push(second);
  return [...path, home];
}
