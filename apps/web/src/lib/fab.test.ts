import { describe, expect, it } from "vitest";
import { fabFor } from "./fab";

describe("which floating button a page shows", () => {
  it("keeps Create on the Library alone", () => {
    expect(fabFor({ path: "/library", playable: false })).toBe("create");
  });

  it("offers Play on Today, the latest briefing at its address, an older briefing and an episode", () => {
    for (const path of ["/", "/d/2026-10-07", "/d/2026-10-05", "/e/ep-20261007-1930"]) {
      expect(fabFor({ path, playable: true }), path).toBe("play");
    }
  });

  it("offers Add on Categories and sources and on a topic's page, and not on Blocked outlets", () => {
    for (const path of [
      "/settings/categories",
      "/settings/categories/design",
      "/settings/categories/other",
    ]) {
      expect(fabFor({ path, playable: false }), path).toBe("add");
    }
    expect(fabFor({ path: "/settings/blocked-outlets", playable: false })).toBeNull();
    expect(fabFor({ path: "/settings/preferences", playable: false })).toBe("reorder");
  });

  it("shows none on a page with nothing to play and nothing to make", () => {
    // Today before the first briefing has nothing to play, and Create lives in the Library.
    for (const path of ["/", "/settings", "/settings/daily", "/create", "/offline", "/404"]) {
      expect(fabFor({ path, playable: false }), path).toBeNull();
    }
  });
});
