import type { Item } from "@dispatch/core";

/**
 * A version number standing as its own word: "ttok 0.4", "@shadcn/registry@0.1.3", "v2.1.0",
 * "0.1a0". Not "Qwen3.8" (part of a name), "20.1%" or "$289.99".
 */
const VERSION =
  /(?:^|[\s@(])v?(\d+)\.(\d+)(?:\.(\d+))?(?:[-.]?(?:a|b|rc|alpha|beta)\d*)?(?=$|[\s,:;)])/i;

/**
 * Share of a briefing's main stories release notes may take. Release notes clear the score bar
 * easily (a judged developer tool launch with no depth still scores about 0.45), and on a busy
 * week they filled a third of the weekly. The owner asked that they not take up much of an
 * episode (2026-10-15).
 */
export const RELEASE_NOTE_SHARE = 0.1;

/**
 * True for a story whose substance is a version: a GitHub release, or a headline that names a
 * version number. Consumer launches ("Android 17", "Galaxy S24") carry no dotted version and are
 * ranked by launch scale instead.
 */
export function isReleaseNote(item: Pick<Item, "source_type" | "title">): boolean {
  return item.source_type === "github" || VERSION.test(item.title);
}

/**
 * True for a patch release ("4.21.5", "@0.0.28"): a dependency update or a bug-fix list, which
 * never airs. A major or minor version ("1.0", "0.16", "1.1.0") may, within the share.
 */
export function isPatchRelease(item: Pick<Item, "title">): boolean {
  const version = VERSION.exec(item.title);
  return version?.[3] !== undefined && version[3] !== "0";
}
