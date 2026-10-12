import { describe, expect, it } from "vitest";
import { isSheetName, OPEN_SHEET_EVENT } from "./sheetEvents";

describe("sheet requests", () => {
  it("accepts the two sheets the header buttons name and nothing else", () => {
    expect(isSheetName("generate")).toBe(true);
    expect(isSheetName("settings")).toBe(true);
    expect(isSheetName("player")).toBe(false);
    expect(isSheetName("")).toBe(false);
    expect(isSheetName(undefined)).toBe(false);
    expect(isSheetName(null)).toBe(false);
  });
});
