import { describe, expect, it } from "vitest";
import { isSheetName, OPEN_SHEET_EVENT } from "./sheetEvents";

describe("sheet requests", () => {
  it("accepts the one sheet the app opens and nothing else", () => {
    expect(isSheetName("generate")).toBe(true);
    // The narration sheet asked for the passphrase; there is none now (D157).
    expect(isSheetName("narrate")).toBe(false);
    // Settings is a page; the sheet that once shadowed it is gone.
    expect(isSheetName("settings")).toBe(false);
    expect(isSheetName("player")).toBe(false);
    expect(isSheetName("")).toBe(false);
    expect(isSheetName(undefined)).toBe(false);
    expect(isSheetName(null)).toBe(false);
  });
});
