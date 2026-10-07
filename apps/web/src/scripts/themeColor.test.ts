import { describe, expect, it } from "vitest";
import { themeColorsFor } from "./themeColor";

const system = { light: "#ffffff", dark: "#202124" };

describe("themeColorsFor", () => {
  it("leaves one colour per system scheme while the theme follows the system", () => {
    expect(themeColorsFor(undefined, system)).toEqual(system);
    expect(themeColorsFor(null, system)).toEqual(system);
    expect(themeColorsFor("system", system)).toEqual(system);
  });

  it("uses the light surface in both schemes once Light is chosen by hand", () => {
    expect(themeColorsFor("light", system)).toEqual({ light: "#ffffff", dark: "#ffffff" });
  });

  it("uses the dark surface in both schemes once Dark is chosen by hand", () => {
    expect(themeColorsFor("dark", system)).toEqual({ light: "#202124", dark: "#202124" });
  });
});
