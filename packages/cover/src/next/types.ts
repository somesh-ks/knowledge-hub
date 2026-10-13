import type { Rng } from "../prng.js";

export type CoverKind = "daily" | "weekly" | "on_demand";

export interface NextCoverInput {
  kind: CoverKind;
  /** Stable episode id; the only thing that varies the art inside a month. */
  id: string;
  /** Episode date, YYYY-MM-DD. */
  date: string;
  /** Required for on_demand: the headline set over the art. */
  title?: string;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ThemeColors {
  /** Deep ground of the month; type zones and scrims. */
  dark: string;
  /** Pale tinted ground, never cream; the weekly's column. */
  light: string;
  /** Art colors for this episode, already shuffled by the episode seed. */
  art: readonly string[];
}

export interface DrawEnv {
  box: Box;
  rng: Rng;
  colors: ThemeColors;
  /** Unique per cover, for ids inside one svg. */
  uid: string;
}

export interface Drawn {
  defs?: string;
  body: string;
}

/** A month's theme: palette data plus the one draw function that makes its motif and surface. */
export interface Theme {
  id: string;
  name: string;
  dark: string;
  light: string;
  art: readonly string[];
  draw(env: DrawEnv): Drawn;
}
