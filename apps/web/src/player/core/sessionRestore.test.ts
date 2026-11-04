import { describe, expect, it } from "vitest";
import { isReturn, parseSession } from "./sessionRestore";

describe("isReturn", () => {
  // A link or a typed address to the app starts clean; only a reload or a step through history brings the tab back.
  it("restores for a reload or history, not for opening an address", () => {
    expect(isReturn([{ type: "reload" }])).toBe(true);
    expect(isReturn([{ type: "back_forward" }])).toBe(true);
    expect(isReturn([{ type: "navigate" }])).toBe(false);
    expect(isReturn([])).toBe(false);
  });
});

describe("parseSession", () => {
  it("reads the track and whether the player was open, and nothing from a bad value", () => {
    expect(parseSession('{"id":"ep-1","open":true}')).toEqual({ id: "ep-1", open: true });
    expect(parseSession('{"id":"ep-1"}')).toEqual({ id: "ep-1", open: false });
    expect(parseSession('{"open":true}')).toBeNull();
    expect(parseSession("nope")).toBeNull();
    expect(parseSession(null)).toBeNull();
  });
});
