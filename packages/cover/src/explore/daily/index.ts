import type { Template } from "../../types.js";
import { risingSun } from "./01-rising-sun.js";
import { cornerRings } from "./02-corner-rings.js";
import { modularGrid } from "./03-modular-grid.js";
import { numeralCrop } from "./04-numeral-crop.js";
import { primitives } from "./05-primitives.js";
import { columnRhythm } from "./06-column-rhythm.js";
import { dotMatrix } from "./07-dot-matrix.js";
import { waveform } from "./08-waveform.js";
import { nestedSquares } from "./09-nested-squares.js";
import { sprout } from "./10-sprout.js";
import { tangram } from "./11-tangram.js";
import { accordionFold } from "./12-accordion-fold.js";
import { bigCrop } from "./13-big-crop.js";
import { tripleArch } from "./14-triple-arch.js";
import { pillLadder } from "./15-pill-ladder.js";
import { harlequinDiamond } from "./16-harlequin-diamond.js";
import { cornerFan } from "./17-corner-fan.js";
import { moonPhases } from "./18-moon-phases.js";
import { pinwheel } from "./19-pinwheel.js";
import { wedgeAndDisc } from "./20-wedge-and-disc.js";

export interface DailyStyle {
  no: number;
  name: string;
  draw: Template;
}

/** The twenty explored daily (full-bleed square) cover styles. Not wired into the picker. */
export const DAILY_STYLES: readonly DailyStyle[] = [
  { no: 1, name: "Rising Sun", draw: risingSun },
  { no: 2, name: "Corner Rings", draw: cornerRings },
  { no: 3, name: "Modular Grid", draw: modularGrid },
  { no: 4, name: "Numeral Crop", draw: numeralCrop },
  { no: 5, name: "Primitives", draw: primitives },
  { no: 6, name: "Column Rhythm", draw: columnRhythm },
  { no: 7, name: "Dot Matrix", draw: dotMatrix },
  { no: 8, name: "Waveform", draw: waveform },
  { no: 9, name: "Nested Squares", draw: nestedSquares },
  { no: 10, name: "Sprout", draw: sprout },
  { no: 11, name: "Tangram", draw: tangram },
  { no: 12, name: "Accordion Fold", draw: accordionFold },
  { no: 13, name: "Big Crop", draw: bigCrop },
  { no: 14, name: "Triple Arch", draw: tripleArch },
  { no: 15, name: "Pill Ladder", draw: pillLadder },
  { no: 16, name: "Harlequin Diamond", draw: harlequinDiamond },
  { no: 17, name: "Corner Fan", draw: cornerFan },
  { no: 18, name: "Moon Phases", draw: moonPhases },
  { no: 19, name: "Pinwheel", draw: pinwheel },
  { no: 20, name: "Wedge and Disc", draw: wedgeAndDisc },
];
