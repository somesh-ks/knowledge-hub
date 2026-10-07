import { describe, expect, it } from "vitest";
import { parseVolume } from "./volume";

describe("parseVolume", () => {
  it("is full volume until something is stored", () => {
    expect(parseVolume(null)).toBe(1);
    expect(parseVolume("")).toBe(1);
  });

  it("reads a stored level and keeps it between silent and full", () => {
    expect(parseVolume("0.35")).toBe(0.35);
    expect(parseVolume("0")).toBe(0);
    expect(parseVolume("7")).toBe(1);
    expect(parseVolume("-2")).toBe(0);
  });

  it("falls back to full volume for anything that is not a number", () => {
    expect(parseVolume("loud")).toBe(1);
    expect(parseVolume("NaN")).toBe(1);
  });
});
