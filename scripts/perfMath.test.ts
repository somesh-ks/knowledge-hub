import { describe, expect, it } from "vitest";
import { cumulativeLayoutShift, medianMetrics, totalBlockingTime } from "./perfMath.js";

const shift = (startTime: number, value: number, hadRecentInput = false) => ({
  startTime,
  value,
  hadRecentInput,
});

describe("the lab probe's arithmetic", () => {
  // Summing every shift overstated CLS on a page that shifts twice, far apart; counting a shift
  // the reader caused (a tap that opens a sheet) blamed the page for it.
  it("reads CLS as the worst session window, without shifts that followed input", () => {
    // Two windows: 0.05 + 0.04 close together, then 0.06 alone after a gap of over a second.
    expect(
      cumulativeLayoutShift([shift(100, 0.05), shift(600, 0.04), shift(2000, 0.06)]),
    ).toBeCloseTo(0.09);
    expect(cumulativeLayoutShift([shift(100, 0.05), shift(300, 0.5, true)])).toBeCloseTo(0.05);
    // Shifts every 900 ms never leave a gap, but a window closes after 5 s.
    const steady = [0, 900, 1800, 2700, 3600, 4500, 5400].map((at) => shift(at, 0.01));
    expect(cumulativeLayoutShift(steady)).toBeCloseTo(0.06);
  });

  // A whole long task counted as blocking (its first 50 ms do not), and the idle tail's timers,
  // past the measured span, inflated TBT.
  it("counts only the blocking part of long tasks that started before the end", () => {
    const tasks = [
      { startTime: 100, duration: 120 },
      { startTime: 900, duration: 50 },
      { startTime: 9000, duration: 400 },
    ];
    expect(totalBlockingTime(tasks, 6000)).toBe(70);
  });

  // One cold load that hit a slow runner moment set the day's number.
  it("takes each metric's median over the loads", () => {
    const run = (lcp_ms: number, cls: number, tbt_ms: number) => ({ lcp_ms, cls, tbt_ms });
    expect(medianMetrics([run(900, 0.2, 10), run(5000, 0, 30), run(1000, 0.01, 900)])).toEqual(
      run(1000, 0.01, 30),
    );
  });
});
