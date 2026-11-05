/**
 * The Slider: one value on a line, set by dragging a thumb. The one place its class is written.
 * Slider.astro renders from it; a script or a React island that draws a slider calls sliderClass();
 * the style guide lists SLIDER. The rules are in styles/slider.css; the caller keeps --range-fill
 * (a percentage) at (value - min) / (max - min), because WebKit paints the filled part of the track from it.
 * A `hue` Slider (D328) draws its rail as the spectrum and wraps the input in a field; the caller keeps
 * --range-fill on that field, which the swatch above the held thumb reads. A `wavy` Slider wraps the input
 * in a field the same way and draws the part of the track up to the thumb as a wave in Expressive and a
 * zigzag in Halloween.
 */
import type { Guidance } from "./guidance";

export const SLIDER: Guidance = {
  summary: "A track with a thumb: a value between two ends, set by dragging or by the arrow keys.",
  useWhen: [
    "The value is on a scale where nearby values are alike: Volume, Playback speed, a topic's weight.",
  ],
  dontUseWhen: [
    {
      when: "There are two to five named options and none is between the others.",
      instead: "Chip",
    },
    {
      when: "Only on and off are possible.",
      instead: "Switch",
    },
  ],
};

/** Variants of the Slider, each with its own guidance (the registry lists them as parts). */
export const SLIDER_VARIANTS: Record<"hue" | "wavy", Guidance> = {
  wavy: {
    summary:
      "A Slider whose track, up to the thumb, drifts: a wave in Expressive, a sharp zigzag in Halloween; the rest of the track stays straight. In Default it is the plain Slider.",
    useWhen: ["The value is the point of its screen and the slider is large: Playback speed."],
    dontUseWhen: [
      {
        when: "The slider is one among many controls in a list, or its track is thin.",
        instead: "Slider",
      },
    ],
  },
  hue: {
    summary:
      "A Slider whose rail is the whole spectrum and whose thumb is the colour picked; holding it floats a round swatch of that colour above.",
    useWhen: ["The value is a hue: the reader turning a style's colour (Settings, Mood)."],
    dontUseWhen: [
      {
        when: "The value is a quantity (volume, speed, a weight), not a colour.",
        instead: "Slider",
      },
      {
        when: "A few named colours are on offer.",
        instead: "Chip",
      },
    ],
  },
};

/** Every class the Slider draws, for the registry and its test. */
export const SLIDER_CLASSES: string[] = [
  "slider-input",
  "slider-hue-field",
  "slider-hue-swatch",
  "slider-wave-field",
];

/** Classes the Slider replaced; none may be written again, in any app that draws the system. */
export const SLIDER_RETIRED: string[] = ["settings-range", "speed-slider"];

/** The class that draws a slider. */
export const sliderClass = (): string => "slider-input";

/** The field a wavy Slider's input stands in (the caller keeps --range-fill on it, as on the input). */
export const sliderWaveFieldClass = (): string => "slider-wave-field";
