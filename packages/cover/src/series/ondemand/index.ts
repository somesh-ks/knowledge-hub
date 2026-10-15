import type { Template } from "../../types.js";
import { s01 } from "./01-horizon.js";
import { s02 } from "./02-hills.js";
import { s03 } from "./03-doorway.js";
import { s04 } from "./04-sleeve.js";
import { s05 } from "./05-stripes.js";
import { s06 } from "./06-slant.js";
import { s07 } from "./07-overlap.js";
import { s08 } from "./08-pinwheel.js";
import { s09 } from "./09-domes.js";
import { s10 } from "./10-level.js";
import { s11 } from "./11-turning.js";
import { s12 } from "./12-casement.js";
import { s13 } from "./13-cards.js";
import { s14 } from "./14-scallops.js";
import { s15 } from "./15-steps.js";
import { s16 } from "./16-pie.js";
import { s17 } from "./17-postcard.js";
import { s18 } from "./18-matrix.js";
import { s19 } from "./19-diamond.js";
import { s20 } from "./20-trio.js";

export interface OnDemandStyle {
  id: string;
  name: string;
  idea: string;
  inspiration: string;
  fn: Template;
}

export const STYLES: OnDemandStyle[] = [
  {
    id: "01",
    name: "Sun on horizon",
    idea: "A disc split by a low horizon with a half sun rising on it.",
    inspiration: "Blue Note and Penguin-poster sunsets",
    fn: s01,
  },
  {
    id: "02",
    name: "Two hills",
    idea: "A small sun over two overlapping hills, all clipped round.",
    inspiration: "Spotify editorial landscape covers",
    fn: s02,
  },
  {
    id: "03",
    name: "Nested doorways",
    idea: "Arches inside arches, the last one a hole to the matte.",
    inspiration: "Louis Kahn arcades and ECM sleeves",
    fn: s03,
  },
  {
    id: "04",
    name: "Record sleeve",
    idea: "A square sleeve holding a disc with a spindle hole.",
    inspiration: "Vinyl packaging and Swiss label design",
    fn: s04,
  },
  {
    id: "05",
    name: "Stripe rhythm",
    idea: "Uneven vertical stripes, one loud, clipped round.",
    inspiration: "Josef Muller-Brockmann concert posters",
    fn: s05,
  },
  {
    id: "06",
    name: "Slant bars",
    idea: "Three or four rounded bars on a slant inside the disc.",
    inspiration: "Bauhaus diagonals and sound levels",
    fn: s06,
  },
  {
    id: "07",
    name: "Ink overlap",
    idea: "Two paper discs on the matte; where they cross, ink.",
    inspiration: "Overprint in Swiss print",
    fn: s07,
  },
  {
    id: "08",
    name: "Quarter pinwheel",
    idea: "Four quarter discs turned like a pinwheel in a disc.",
    inspiration: "Bauhaus tile studies and Anni Albers",
    fn: s08,
  },
  {
    id: "09",
    name: "Nested domes",
    idea: "Half discs inside half discs on a flat base.",
    inspiration: "Mid-century Scandinavian rainbow posters",
    fn: s09,
  },
  {
    id: "10",
    name: "Level pill",
    idea: "A tall pill filled part way, like a sound or battery level.",
    inspiration: "iOS controls and Dieter Rams gauges",
    fn: s10,
  },
  {
    id: "11",
    name: "Turning halves",
    idea: "Three discs, each holding a half that turns.",
    inspiration: "Moon-phase charts and Bruno Munari",
    fn: s11,
  },
  {
    id: "12",
    name: "Four panes",
    idea: "Four panes: a disc, a corner, a dome and a blank.",
    inspiration: "Bauhaus window and glyph sets",
    fn: s12,
  },
  {
    id: "13",
    name: "Offset cards",
    idea: "A paper card on an ink card, a sun on the front one.",
    inspiration: "Stacked editorial cards, Pentagram",
    fn: s13,
  },
  {
    id: "14",
    name: "Scallop wave",
    idea: "Rows of half discs facing alternately, a calm wave.",
    inspiration: "Seigaiha pattern and Alvin Lustig",
    fn: s14,
  },
  {
    id: "15",
    name: "Rising steps",
    idea: "Five blocks climbing, a sun in the tallest.",
    inspiration: "Blue Note stair rhythm, Reid Miles",
    fn: s15,
  },
  {
    id: "16",
    name: "Two slices",
    idea: "A donut with an accent slice and a shade slice.",
    inspiration: "Isotype and Otl Aicher pictograms",
    fn: s16,
  },
  {
    id: "17",
    name: "Postcard",
    idea: "A landscape card with a half sun and a small hill.",
    inspiration: "Travel-poster cards and Saul Bass",
    fn: s17,
  },
  {
    id: "18",
    name: "Dot matrix",
    idea: "A grid of paper dots with one dot in ink.",
    inspiration: "Swiss grid posters, Karl Gerstner",
    fn: s18,
  },
  {
    id: "19",
    name: "Diamond and sun",
    idea: "A turned square holding a large disc.",
    inspiration: "Josef Albers and Bauhaus emblems",
    fn: s19,
  },
  {
    id: "20",
    name: "Three rings",
    idea: "Three overlapping discs with the overlaps picked out.",
    inspiration: "Venn marks and Paul Rand logos",
    fn: s20,
  },
];
