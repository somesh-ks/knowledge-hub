import type { Category } from "@dispatch/core";
import type { CoverPicker } from "../render/buildDigest.js";
import type { CoverPickFn } from "./types.js";

/**
 * Adapts the cover package's picker to the digest builder. The lead is the highest-scoring item,
 * which is first in digest order; a video lead is reported as "watch", the section it belongs to.
 */
export function makeCoverPicker(
  pick: CoverPickFn,
  previous?: { template: string; palette: string },
): CoverPicker {
  return ({ digestId, date, kind, items }) => {
    const lead = items[0];
    const leadCategory: Category | "watch" | undefined = lead
      ? lead.source_type === "youtube"
        ? "watch"
        : lead.category
      : undefined;
    return pick({
      id: digestId,
      date,
      kind,
      ...(leadCategory ? { lead_category: leadCategory } : {}),
      ...(previous ? { previous } : {}),
    });
  };
}
