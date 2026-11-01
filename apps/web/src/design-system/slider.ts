/**
 * The Slider: one value on a line, set by dragging a thumb. The one place its class is written.
 * Slider.astro renders from it; a script or a React island that draws a slider calls sliderClass();
 * the style guide lists SLIDER. The rules are in styles/slider.css; the caller keeps --range-fill
 * (a percentage) at (value - min) / (max - min), because WebKit paints the filled part of the track from it.
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

/** Every class the Slider draws, for the registry and its test. */
export const SLIDER_CLASSES: string[] = ["slider-input"];

/** Classes the Slider replaced; none may be written again, in any app that draws the system. */
export const SLIDER_RETIRED: string[] = ["settings-range", "speed-slider"];

/** The class that draws a slider. */
export const sliderClass = (): string => "slider-input";
