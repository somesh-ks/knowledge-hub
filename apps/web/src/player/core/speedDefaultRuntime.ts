import { getPreferences } from "./preferences";
import { safeLocalStorage } from "./resume";
import { createSpeedDefault, type SpeedDefault } from "./speedDefault";

let shared: SpeedDefault | null = null;

/** The app-wide speed default and its offer. Created on first use. */
export function getSpeedDefault(): SpeedDefault {
  shared ??= createSpeedDefault({ storage: safeLocalStorage(), preferences: getPreferences() });
  return shared;
}
