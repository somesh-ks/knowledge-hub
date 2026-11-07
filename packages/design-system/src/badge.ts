/**
 * The Badge: a small grey pill that holds one word or one number. The one place its class is
 * written. Badge.astro renders from it; the style guide lists BADGE. The rules are in
 * styles/badge.css.
 */
import type { Guidance } from "./guidance";

export const BADGE: Guidance = {
  summary: "A grey label holding one word or one number beside a name.",
  useWhen: [
    "A short label names what the thing beside it is: Admin beside the wordmark.",
    "A count of what a section holds.",
  ],
  dontUseWhen: [
    {
      when: "The state is good, worth a look or wrong.",
      instead: "Banner",
    },
    {
      when: "The pill can be pressed or ticked.",
      instead: "Chip",
    },
  ],
};

/** Every class the Badge draws, for the registry and its test. */
export const BADGE_CLASSES: string[] = ["badge-label"];

/** Classes the Badge replaced; none may be written again, in any app that draws the system. */
export const BADGE_RETIRED: string[] = [];

/** The class that draws a badge, for a script or an island. */
export const badgeClass = (): string => "badge-label";
