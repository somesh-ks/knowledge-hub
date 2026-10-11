import { describe, expect, it } from "vitest";
import { fabFor } from "./fab";

describe("which floating button a page shows", () => {
  it("keeps Create on Today, the latest briefing at its address, and the Library", () => {
    expect(fabFor({ today: true, path: "/", playable: true })).toBe("create");
    expect(fabFor({ today: true, path: "/d/2026-10-07", playable: true })).toBe("create");
    // Today with no briefing yet still offers to make an episode.
    expect(fabFor({ today: true, path: "/", playable: false })).toBe("create");
    expect(fabFor({ today: false, path: "/library", playable: false })).toBe("create");
  });

  it("offers Play on an episode and an older briefing", () => {
    expect(fabFor({ today: false, path: "/e/ep-20261007-1930", playable: true })).toBe("play");
    expect(fabFor({ today: false, path: "/d/2026-10-05", playable: true })).toBe("play");
  });

  it("shows none on a page with nothing to play and nothing to make", () => {
    for (const path of ["/settings", "/settings/daily", "/create", "/offline", "/404"]) {
      expect(fabFor({ today: false, path, playable: false }), path).toBeNull();
    }
  });
});
