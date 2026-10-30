/**
 * The Banner: a flat, tinted block that tells a person something about the page or the device and,
 * at most, offers one way on. The one place its classes are written. Banner.astro renders from it; a
 * script or a React island that draws one calls bannerClass() and the part helpers; the style guide
 * lists BANNER. The rules are in styles/banner.css.
 */
import type { Guidance } from "./guidance";

export type BannerTone = "info" | "warning" | "danger" | "success";

export const BANNER: Guidance & {
  tones: Record<BannerTone, Guidance & { label: string }>;
} = {
  summary: "A tinted block with an icon, a title, an optional line and at most one text button.",
  useWhen: [
    "A state a person must know about stays on screen: offline, a failed run, a playback error.",
  ],
  dontUseWhen: [
    {
      when: "The message confirms an action and may clear itself.",
    },
    {
      when: "A person must decide before going on.",
    },
  ],
  tones: {
    info: {
      label: "Info",
      summary: "A neutral fact: a new version is ready, playback paused for a call.",
      useWhen: ["Nothing is wrong and nothing is lost."],
      dontUseWhen: [{ when: "Something failed.", instead: "Banner.danger" }],
    },
    warning: {
      label: "Warning",
      summary: "Something is limited but still works: offline, an old briefing.",
      useWhen: ["The page still works in part, and the limit may pass."],
      dontUseWhen: [
        { when: "The action a person asked for did not happen.", instead: "Banner.danger" },
      ],
    },
    danger: {
      label: "Danger",
      summary: "Something failed: a run, a download, playback. Announced at once as an alert.",
      useWhen: ["The thing a person asked for did not happen, and they can act on it."],
      dontUseWhen: [{ when: "It is a state that is working as designed.", instead: "Banner.info" }],
    },
    success: {
      label: "Success",
      summary: "Something recovered: back online.",
      useWhen: ["A problem a banner showed is over."],
      dontUseWhen: [{ when: "An action simply worked.", instead: "Banner.info" }],
    },
  },
};

/** Every class the Banner draws, for the registry and its test. */
export const BANNER_CLASSES: string[] = [
  "banner-notice",
  "banner-text",
  "banner-title",
  "banner-body",
];

/** Classes the Banner replaced; none may be written again, in any app that draws the system. */
export const BANNER_RETIRED: string[] = ["player-notice", "player-notice-action"];

/** The class that draws a banner's block, for a script or an island. */
export const bannerClass = (): string => "banner-notice";

/** The classes of a banner's parts, for an island that builds its own content. */
export const bannerText = {
  /** The column beside the icon that holds the title and the body. */
  column: "banner-text",
  title: "banner-title",
  body: "banner-body",
} as const;
