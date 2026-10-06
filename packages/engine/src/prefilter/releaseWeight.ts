import type { Item } from "@dispatch/core";

const VERSION = /(\d+)\.(\d+)\.(\d+)/;

/**
 * Ranking adjustment for GitHub release notes, where a monorepo can publish a dozen patch
 * releases a day. A major or minor version (x.0.0, x.y.0) and notes that open with "Major
 * Changes" or "Minor Changes" (the changesets convention) are worth reading; patch-only notes
 * are the noise. Zero for everything that is not a GitHub release.
 */
export function releaseWeight(item: Pick<Item, "source_type" | "title" | "snippet">): number {
  if (item.source_type !== "github") return 0;
  let weight = 0;
  const version = VERSION.exec(item.title);
  if (version && version[3] === "0") weight += version[2] === "0" ? 2.5 : 1.5;
  if (/^major changes/i.test(item.snippet)) weight += 1.5;
  else if (/^minor changes/i.test(item.snippet)) weight += 1;
  else if (/^patch changes/i.test(item.snippet)) weight -= 0.5;
  return weight;
}
