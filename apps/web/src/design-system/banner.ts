/**
 * The Banner: a flat, tinted block that tells a person something about the page or the device and,
 * at most, offers one way on. The one place its classes are written. Banner.astro renders from it; a
 * script or a React island that draws one calls bannerClass() and the part helpers; the style guide
 * lists BANNER. The rules are in styles/banner.css.
 */
import type { Guidance } from "./guidance";

export type BannerTone = "info" | "warning" | "danger" | "success";

/** A block sits in the page; a strip is a band above the app that squeezes the page down (banner.css), for a state of the device. */
export type BannerVariant = "block" | "strip";

export const BANNER: Guidance & {
  variants: Record<BannerVariant, Guidance & { label: string }>;
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
      when: "A banner in the page would be moved around by a page change (a cover between pages).",
      instead: "Banner.strip",
    },
    {
      when: "A person must decide before going on.",
    },
  ],
  variants: {
    block: {
      label: "Block",
      summary: "A tinted block in the page, above the content it belongs to.",
      useWhen: ["The banner belongs to one page and may take its own line."],
      dontUseWhen: [
        { when: "It tells the state of the device, on every page.", instead: "Banner.strip" },
      ],
    },
    strip: {
      label: "Strip",
      summary:
        "A band across the top of the app that squeezes the page down while it shows: offline, back online.",
      useWhen: ["The state is the device's, not the page's, and shows on every page."],
      dontUseWhen: [
        { when: "It carries a title, a line and an action.", instead: "Banner.warning" },
      ],
    },
  },
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
  // A strip's icon is drawn as a signal: one layer, or two when the second strikes through the first.
  "banner-signal",
  "banner-signal-layer",
  "banner-signal-from",
  "banner-signal-to",
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
