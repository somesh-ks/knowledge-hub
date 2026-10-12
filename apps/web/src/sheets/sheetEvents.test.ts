import { describe, expect, it } from "vitest";
import { isSheetName, OPEN_SHEET_EVENT } from "./sheetEvents";

describe("sheet requests", () => {
  it("accepts the two sheets the app opens and nothing else", () => {
    expect(isSheetName("generate")).toBe(true);
    expect(isSheetName("narrate")).toBe(true);
    // Settings is a page; the sheet that once shadowed it is gone.
    expect(isSheetName("settings")).toBe(false);
    expect(isSheetName("player")).toBe(false);
    expect(isSheetName("")).toBe(false);
    expect(isSheetName(undefined)).toBe(false);
    expect(isSheetName(null)).toBe(false);
  });

  it("uses a namespaced event name so it cannot collide with the page's own", () => {
    expect(OPEN_SHEET_EVENT).toBe("dispatch:open-sheet");
  });
});
