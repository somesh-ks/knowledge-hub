import { describe, expect, it } from "vitest";
import { nearestRegenLength } from "./regenLength";

// A Regenerate that started on "Usual" sent no length, so a Daily could be remade at another
// length than it aired. The sheet now starts on the length the podcast aired at.
describe("nearestRegenLength", () => {
  it("rounds an aired length to the offer it was made at, a tie going longer", () => {
    expect(nearestRegenLength(4)).toBe(5);
    expect(nearestRegenLength(9)).toBe(10);
    expect(nearestRegenLength("13")).toBe(15);
    expect(nearestRegenLength(20)).toBe(15);
    expect(nearestRegenLength(1)).toBe(3);
  });

  it("starts on 5 when the length is not known", () => {
    expect(nearestRegenLength(undefined)).toBe(5);
    expect(nearestRegenLength("")).toBe(5);
    expect(nearestRegenLength("soon")).toBe(5);
  });
});
