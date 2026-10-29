import { MAX_REGENERATIONS } from "@singularity/core";

/**
 * What a Regenerate item says about its podcast's regenerations (D212): the tooltip counter, and
 * whether the item is spent. `used` is the podcast's own count; absent means never regenerated.
 */
export function regenerationHint(used: number | undefined): {
  title: string;
  exhausted: boolean;
} {
  const left = Math.max(0, MAX_REGENERATIONS - (used ?? 0));
  return left === 0
    ? {
        title: `Regenerated ${MAX_REGENERATIONS} times, the most a podcast takes`,
        exhausted: true,
      }
    : { title: `${left} of ${MAX_REGENERATIONS} regenerations left`, exhausted: false };
}
