import { describe, expect, it } from "vitest";
import { handleAnalytics } from "./analyticsApi";
import { countsFrom, loopFigures } from "./analyticsStats";

describe("the Analytics page's figures", () => {
  // A week with no listens divided 0 by 0 and drew "NaN%" (or Infinity for shares with no visitors):
  // a loop that has not turned reads as no data, never as a number.
  it("reads a loop with nothing to divide by as no data", () => {
    const empty = loopFigures(countsFrom({}, {}));
    expect(Object.values(empty).map((figure) => figure.value)).toEqual([
      "No data",
      "No data",
      "No data",
      "No data",
    ]);
  });

  // Simple Analytics leaves out an event nothing fired and spells a referrer as it was sent; a count
  // read from the wrong key was 0 with no error, so the loops looked dead.
  it("counts shared-link visits by the referrer `share` and an unfired event as 0", () => {
    const counts = countsFrom(
      { visitors: 50, pageviews: 90, referrers: [{ value: "Share", visitors: 6 }] },
      {
        events: [
          { name: "share", total: 12 },
          { name: "listen_start", total: 20 },
          { name: "listen_half", total: 10 },
        ],
      },
    );
    const figures = loopFigures(counts);
    expect(counts.events.listen_complete).toBe(0);
    expect(figures.visits_per_share?.value).toBe("0.50");
    expect(figures.listen_through?.value).toBe("50%");
  });

  // A failed ask is not a quiet week: it must not answer 200 with zeros.
  it("answers 503 with no key and 502 when Simple Analytics fails", async () => {
    expect((await handleAnalytics("GET", null)).status).toBe(503);
    const failing = await handleAnalytics("GET", async () => {
      throw new Error("down");
    });
    expect(failing.status).toBe(502);
  });
});
