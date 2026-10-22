import { describe, expect, it } from "vitest";
import { addShift, pageReport, startPage } from "./vitalsMeasure";

describe("CLS session windows", () => {
  // The window opened at time 0, not at the first shift, so its 5 s cap ran from 0 and split a
  // window web.dev counts whole: CLS read low.
  it("opens the first window at the first shift and caps it 5 s from there", () => {
    const vitals = startPage("/");
    for (const at of [500, 1400, 2300, 3200, 4100, 5000, 5300]) addShift(vitals, at, 0.01);
    expect(JSON.parse(pageReport(vitals) ?? "{}").cls).toBe(0.07);
    addShift(vitals, 5600, 0.01);
    expect(vitals.window.value).toBeCloseTo(0.01);
  });
});
