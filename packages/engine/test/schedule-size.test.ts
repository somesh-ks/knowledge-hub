import { describe, expect, it } from "vitest";
import { capForLength } from "../src/run/scheduleSize.js";

describe("capForLength", () => {
  it("keeps the whole cap at 10 and 15 minutes", () => {
    expect(capForLength(12, 3, 10)).toBe(12);
    expect(capForLength(12, 3, 15)).toBe(12);
  });

  it("keeps a share of it for a shorter podcast", () => {
    expect(capForLength(12, 3, 5)).toBe(6);
    expect(capForLength(12, 3, 3)).toBe(4);
  });

  it("never goes below the floor", () => {
    expect(capForLength(12, 5, 3)).toBe(5);
  });
});
