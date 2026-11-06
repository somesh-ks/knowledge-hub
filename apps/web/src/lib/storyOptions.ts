import { autoStories, mostStories, STORY_COUNTS } from "@singularity/core/storyCount";

/**
 * The Stories control beside Length (D377), on every surface that sets a podcast's size: Auto,
 * which says how many the length holds, then the counts on offer. A count the length cannot hold
 * stays in the list hidden and disabled, so a change of length can bring it back. Client-safe.
 */
export interface StoryOption {
  /** "" is Auto. */
  value: string;
  label: string;
  hidden: boolean;
}

export function storyOptions(minutes: number): StoryOption[] {
  const most = mostStories(minutes);
  return [
    { value: "", label: `Auto (${autoStories(minutes)})`, hidden: false },
    ...STORY_COUNTS.map((count) => ({
      value: String(count),
      label: String(count),
      hidden: count > most,
    })),
  ];
}

/** The value a Stories control sends: null for Auto, else the count. */
export function storiesValue(value: string): number | null {
  return value === "" ? null : Number(value);
}

/**
 * The count one step from `from` along the counts this length holds: "more" is the next count above
 * it, "fewer" the next below. A step past either end stays at the end.
 */
export function stepStories(from: number, direction: "more" | "fewer", minutes: number): number {
  const offered = STORY_COUNTS.filter((count) => count <= mostStories(minutes));
  if (offered.length === 0) return from;
  if (direction === "more")
    return offered.find((count) => count > from) ?? (offered.at(-1) as number);
  return [...offered].reverse().find((count) => count < from) ?? (offered[0] as number);
}

/**
 * Keeps a Stories select to what `minutes` holds: Auto's count follows the length, a count it cannot
 * hold is hidden, and a pick of one moves to the most it holds. Returns whether the pick moved, so
 * a page that saves on change can send it.
 */
export function fitStories(select: HTMLSelectElement, minutes: number): boolean {
  const options = storyOptions(minutes);
  for (const option of select.options) {
    const fit = options.find((entry) => entry.value === option.value);
    if (!fit) continue;
    option.textContent = fit.label;
    option.hidden = fit.hidden;
    option.disabled = fit.hidden;
  }
  const moved = select.selectedOptions[0]?.disabled === true;
  if (moved) {
    const held = options.filter((entry) => !entry.hidden).at(-1);
    select.value = held?.value ?? "";
  }
  select.dispatchEvent(new Event("picker:sync"));
  return moved;
}
