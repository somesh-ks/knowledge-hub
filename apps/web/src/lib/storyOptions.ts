import { autoStories, mostStories, STORY_COUNTS } from "@singularity/core/storyCount";

/**
 * The Stories control beside Length (D377), on every surface that sets a podcast's size: the counts
 * on offer, in order, with Auto among them where its count falls ("Auto (29)" between 25 and 30), so
 * the list, and the wheel a phone turns it on, reads as one run of numbers. On the wheel Auto is
 * its number alone (owner, 2026-11-06: the word Auto only in the list), so a count equal to Auto's
 * is left out, or the wheel would show it twice. A count the length cannot hold stays in the list
 * hidden and disabled, so a change of length can bring it back. Client-safe.
 */
export interface StoryOption {
  /** "" is Auto. */
  value: string;
  label: string;
  /** What the wheel shows in place of the label (data-wheel-text); only Auto has one. */
  wheel?: string;
  hidden: boolean;
}

export function storyOptions(minutes: number): StoryOption[] {
  const most = mostStories(minutes);
  const auto = autoStories(minutes);
  const counts: StoryOption[] = STORY_COUNTS.map((count) => ({
    value: String(count),
    label: String(count),
    hidden: count > most || count === auto,
  }));
  const at = STORY_COUNTS.findIndex((count) => count >= auto);
  counts.splice(at < 0 ? counts.length : at, 0, {
    value: "",
    label: `Auto (${auto})`,
    wheel: String(auto),
    hidden: false,
  });
  return counts;
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
 * Keeps a Stories select to what `minutes` holds: Auto's count and place follow the length, a count
 * it cannot hold or that Auto now equals is hidden, and a pick of one moves to Auto if they are
 * equal, else to the most the length holds. Returns whether the pick
 * moved, so a page that saves on change can send it.
 */
export function fitStories(select: HTMLSelectElement, minutes: number): boolean {
  const options = storyOptions(minutes);
  for (const option of select.options) {
    const fit = options.find((entry) => entry.value === option.value);
    if (!fit) continue;
    option.textContent = fit.label;
    if (fit.wheel) option.dataset.wheelText = fit.wheel;
    option.hidden = fit.hidden;
    option.disabled = fit.hidden;
  }
  // Auto moves to where its count now falls; a moved option keeps its selection.
  const auto = Array.from(select.options).find((option) => option.value === "");
  const after = options[options.findIndex((entry) => entry.value === "") + 1];
  const next = after && Array.from(select.options).find((option) => option.value === after.value);
  if (auto && auto.nextElementSibling !== (next ?? null)) select.insertBefore(auto, next ?? null);
  const picked = select.selectedOptions[0];
  const moved = picked?.disabled === true;
  if (moved) {
    // A pick Auto now equals becomes Auto; one the length cannot hold, the most it holds.
    const same = options.find((entry) => entry.value === "")?.wheel === picked?.value;
    const held = options.filter((entry) => !entry.hidden).at(-1);
    select.value = same ? "" : (held?.value ?? "");
  }
  select.dispatchEvent(new Event("picker:sync"));
  return moved;
}
