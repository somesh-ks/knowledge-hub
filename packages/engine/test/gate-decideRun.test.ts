import type { LastRunFile, RunRecord } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { decideRun } from "../src/gate/decideRun.js";

const record = (at: string, outcome: RunRecord["outcome"] = "published"): RunRecord => ({
  at,
  outcome,
  items: outcome === "published" ? 11 : 0,
});
const lastWith = (regular?: RunRecord, weekly?: RunRecord): LastRunFile => ({
  version: 1,
  ...(regular ? { regular } : {}),
  ...(weekly ? { weekly } : {}),
});
const scheduled = (now: string, last: LastRunFile, force = false) =>
  decideRun({ now: new Date(now), mode: "scheduled", lastRun: last, force });
/** No weekly podcast, so a Sunday is a day like any other: for the tests of the cadence alone. */
const NO_WEEKLY = { enabled: false, day: 0, hour: 0 };

describe("decideRun: cadence_days from the schedule", () => {
  const last = lastWith(record("2026-10-01T05:13:00Z"));
  const withCadence = (now: string, cadenceDays: number) =>
    decideRun({
      now: new Date(now),
      mode: "scheduled",
      lastRun: last,
      force: false,
      cadenceDays,
      weekly: NO_WEEKLY,
    });

  it.each([
    [1, "2026-10-02T05:13:00Z", true],
    [1, "2026-10-01T15:00:00Z", false],
    [2, "2026-10-02T05:13:00Z", false],
    [2, "2026-10-03T05:13:00Z", true],
    [3, "2026-10-03T05:13:00Z", false],
    [3, "2026-10-04T05:13:00Z", true],
    [7, "2026-10-07T05:13:00Z", false],
    [7, "2026-10-08T05:13:00Z", true],
  ])("cadence %i on %s is due: %s", (cadence, now, due) => {
    expect(withCadence(now, cadence).due).toBe(due);
  });

  it("keeps two days when no cadence is given", () => {
    expect(scheduled("2026-10-02T05:13:00Z", last).due).toBe(false);
    expect(scheduled("2026-10-03T05:13:00Z", last).due).toBe(true);
  });

  it("says how many days remain in the chosen cadence", () => {
    expect(withCadence("2026-10-02T05:13:00Z", 7).reason).toContain("6 day(s)");
  });
});

describe("decideRun: cadence by Stockholm calendar date", () => {
  it("is due when no regular digest exists", () => {
    expect(scheduled("2026-10-07T05:13:00Z", lastWith())).toMatchObject({
      due: true,
      runWeekly: false,
    });
  });

  it("is not due the day after a digest and is due two days after", () => {
    const last = lastWith(record("2026-10-05T05:13:00Z"));
    expect(scheduled("2026-10-06T05:13:00Z", last)).toMatchObject({ due: false });
    expect(scheduled("2026-10-07T05:13:00Z", last)).toMatchObject({ due: true });
    expect(scheduled("2026-10-08T05:13:00Z", last)).toMatchObject({ due: true });
  });

  it("is not due again on the same day", () => {
    const last = lastWith(record("2026-10-07T05:13:00Z"));
    expect(scheduled("2026-10-07T15:00:00Z", last)).toMatchObject({ due: false });
  });

  it("changes date at Stockholm midnight, not at UTC midnight", () => {
    const last = lastWith(record("2026-10-05T05:13:00Z"));
    // 21:59:59Z on 6 October is 23:59:59 in Stockholm (CEST): still one day after.
    expect(scheduled("2026-10-06T21:59:59Z", last).due).toBe(false);
    // One second later it is 7 October in Stockholm, two days after the last digest.
    expect(scheduled("2026-10-06T22:00:00Z", last).due).toBe(true);
  });

  it("uses the date of the last run in Stockholm, not in UTC", () => {
    // 23:30Z on 5 October is 01:30 on 6 October in Stockholm, so the next due date is 8 October.
    const last = lastWith(record("2026-10-05T23:30:00Z"));
    expect(scheduled("2026-10-07T05:13:00Z", last).due).toBe(false);
    expect(scheduled("2026-10-08T05:13:00Z", last).due).toBe(true);
  });

  it("stays due when the 07:13 cron is delayed by up to ten hours, on any date", () => {
    const last = lastWith(record("2026-10-05T05:13:00Z"));
    for (let delay = 0; delay <= 10; delay++) {
      const now = new Date(Date.parse("2026-10-07T05:13:00Z") + delay * 3_600_000);
      expect(
        decideRun({ now, mode: "scheduled", lastRun: last, force: false, weekly: NO_WEEKLY }).due,
      ).toBe(true);
    }
  });

  it("does not become due early on the day before, however late that cron runs", () => {
    const last = lastWith(record("2026-10-05T05:13:00Z"));
    for (let delay = 0; delay <= 10; delay++) {
      const now = new Date(Date.parse("2026-10-06T05:13:00Z") + delay * 3_600_000);
      expect(decideRun({ now, mode: "scheduled", lastRun: last, force: false }).due).toBe(false);
    }
  });
});

describe("decideRun: daylight saving changeovers", () => {
  it("is due on 29 March 2026 although only 47 hours passed (spring forward)", () => {
    // 07:13 CET on 27 March is 06:13Z; 07:13 CEST on 29 March is 05:13Z.
    const last = lastWith(record("2026-03-27T06:13:00Z"));
    const now = new Date("2026-03-29T05:13:00Z");
    expect(now.getTime() - Date.parse("2026-03-27T06:13:00Z")).toBe(47 * 3_600_000);
    expect(
      decideRun({ now, mode: "scheduled", lastRun: last, force: false, weekly: NO_WEEKLY }).due,
    ).toBe(true);
  });

  it("is due on 25 October 2026 two days after the 23rd although 49 hours passed (fall back)", () => {
    const last = lastWith(record("2026-10-23T05:13:00Z"));
    const now = new Date("2026-10-25T06:13:00Z");
    expect(now.getTime() - Date.parse("2026-10-23T05:13:00Z")).toBe(49 * 3_600_000);
    expect(
      decideRun({ now, mode: "scheduled", lastRun: last, force: false, weekly: NO_WEEKLY }).due,
    ).toBe(true);
  });

  it("is not due on the changeover day itself when the last digest was the day before", () => {
    expect(scheduled("2026-03-29T05:13:00Z", lastWith(record("2026-03-28T06:13:00Z"))).due).toBe(
      false,
    );
    expect(scheduled("2026-10-25T06:13:00Z", lastWith(record("2026-10-24T05:13:00Z"))).due).toBe(
      false,
    );
  });

  it("keeps the delayed cron on the changeover date for several hours", () => {
    const last = lastWith(record("2026-10-23T05:13:00Z"));
    for (let delay = 0; delay <= 8; delay++) {
      const now = new Date(Date.parse("2026-10-25T06:13:00Z") + delay * 3_600_000);
      const decision = decideRun({
        now,
        mode: "scheduled",
        lastRun: last,
        force: false,
        weekly: NO_WEEKLY,
      });
      expect(decision.date).toBe("2026-10-25");
      expect(decision.due).toBe(true);
    }
  });
});

describe("decideRun: weekly pass on Sundays", () => {
  const sunday = "2026-10-11T05:13:00Z";

  it("runs the weekly pass on a Sunday, and a briefing due that day waits", () => {
    const decision = scheduled(sunday, lastWith(record("2026-10-09T05:13:00Z")));
    expect(decision).toMatchObject({ due: false, runWeekly: true, date: "2026-10-11" });
  });

  it("runs the weekly pass on a Sunday even when no regular digest is due", () => {
    const decision = scheduled(sunday, lastWith(record("2026-10-10T05:13:00Z")));
    expect(decision).toMatchObject({ due: false, runWeekly: true });
  });

  it("does not run the weekly pass on other days", () => {
    expect(scheduled("2026-10-12T05:13:00Z", lastWith()).runWeekly).toBe(false);
    expect(scheduled("2026-10-10T05:13:00Z", lastWith()).runWeekly).toBe(false);
  });

  it("treats Sunday by the Stockholm date", () => {
    // Saturday 22:30Z is already Sunday 00:30 in Stockholm; Sunday 22:30Z is already Monday.
    expect(scheduled("2026-10-10T22:30:00Z", lastWith()).runWeekly).toBe(true);
    expect(scheduled("2026-10-11T22:30:00Z", lastWith()).runWeekly).toBe(false);
  });

  it("runs the weekly pass once per Sunday", () => {
    const done = lastWith(record("2026-10-09T05:13:00Z"), record("2026-10-11T05:20:00Z"));
    expect(scheduled("2026-10-11T12:00:00Z", done).runWeekly).toBe(false);
    const lastSunday = lastWith(record("2026-10-09T05:13:00Z"), record("2026-10-04T05:20:00Z"));
    expect(scheduled(sunday, lastSunday).runWeekly).toBe(true);
  });

  it("runs the weekly pass on the spring changeover Sunday", () => {
    expect(scheduled("2026-03-29T05:13:00Z", lastWith()).runWeekly).toBe(true);
  });

  it("retries the weekly pass after a failed one", () => {
    const failed = lastWith(undefined, record("2026-10-11T05:20:00Z", "failed"));
    expect(scheduled("2026-10-11T12:00:00Z", failed).runWeekly).toBe(true);
  });
});

describe("decideRun: the weekly podcast takes its day", () => {
  const slot = { enabled: true, day: 0, hour: 18 };
  const at = (now: string, last: LastRunFile, weekly = slot, cadenceDays = 2) =>
    decideRun({
      now: new Date(now),
      mode: "scheduled",
      lastRun: last,
      force: false,
      cadenceDays,
      weekly,
    });
  // Friday 9 October briefing; Sunday 11 October is the weekly day.
  const friday = record("2026-10-09T05:13:00Z");

  it("makes no briefing on the weekly day, before or after the weekly hour", () => {
    expect(at("2026-10-11T05:13:00Z", lastWith(friday))).toMatchObject({
      due: false,
      runWeekly: false,
      reason: "today is the weekly podcast's day; no briefing",
    });
    expect(at("2026-10-11T16:10:00Z", lastWith(friday))).toMatchObject({
      due: false,
      runWeekly: true,
    });
  });

  it("counts the cadence from the weekly podcast, so the next briefing keeps its spacing", () => {
    const weekly = lastWith(friday, record("2026-10-11T16:20:00Z"));
    expect(at("2026-10-12T05:13:00Z", weekly)).toMatchObject({
      due: false,
      reason: "last podcast was the weekly one on 2026-10-11; next is due 1 day(s) from now",
    });
    expect(at("2026-10-13T05:13:00Z", weekly)).toMatchObject({
      due: true,
      reason: "last podcast was the weekly one on 2026-10-11, 2 days ago",
    });
  });

  it("counts a weekly podcast only when it published", () => {
    const empty = lastWith(friday, record("2026-10-11T16:20:00Z", "nothing"));
    expect(at("2026-10-12T05:13:00Z", empty).due).toBe(true);
  });

  it("counts from the later of the two, so an older weekly changes nothing", () => {
    const later = lastWith(record("2026-10-13T05:13:00Z"), record("2026-10-11T16:20:00Z"));
    expect(at("2026-10-14T05:13:00Z", later).due).toBe(false);
    expect(at("2026-10-15T05:13:00Z", later).due).toBe(true);
  });

  it("leaves Sunday to the briefing while the weekly podcast is off", () => {
    expect(at("2026-10-11T05:13:00Z", lastWith(friday), { ...slot, enabled: false }).due).toBe(
      true,
    );
  });

  it("still runs a briefing the owner asks for", () => {
    const forced = decideRun({
      now: new Date("2026-10-11T05:13:00Z"),
      mode: "scheduled",
      lastRun: lastWith(friday),
      force: true,
      weekly: slot,
    });
    expect(forced.due).toBe(true);
    const onDemand = decideRun({
      now: new Date("2026-10-11T05:13:00Z"),
      mode: "on-demand",
      lastRun: lastWith(friday),
      force: false,
      weekly: slot,
    });
    expect(onDemand.due).toBe(true);
  });
});

describe("decideRun: the weekly slot", () => {
  const slot = { enabled: true, day: 5, hour: 18 };
  const at = (now: string, last: LastRunFile, weekly = slot) =>
    decideRun({ now: new Date(now), mode: "scheduled", lastRun: last, force: false, weekly });
  // Friday 9 October 2026; 18:00 in Stockholm (CEST) is 16:00Z.
  const quiet = lastWith(record("2026-10-09T05:13:00Z"));

  it("is due on its day from its hour, independent of the daily cadence", () => {
    expect(at("2026-10-09T15:59:00Z", quiet).runWeekly).toBe(false);
    expect(at("2026-10-09T16:00:00Z", quiet)).toMatchObject({ due: false, runWeekly: true });
    expect(at("2026-10-09T21:30:00Z", quiet).runWeekly).toBe(true);
  });

  it("is not due on other days, including Sunday", () => {
    expect(at("2026-10-10T16:13:00Z", quiet).runWeekly).toBe(false);
    expect(at("2026-10-11T16:13:00Z", quiet).runWeekly).toBe(false);
  });

  it("runs once per date and retries after a failed one", () => {
    const done = lastWith(quiet.regular, record("2026-10-09T16:20:00Z"));
    expect(at("2026-10-09T18:13:00Z", done).runWeekly).toBe(false);
    const failed = lastWith(quiet.regular, record("2026-10-09T16:20:00Z", "failed"));
    expect(at("2026-10-09T18:13:00Z", failed).runWeekly).toBe(true);
  });

  it("is off when disabled, and weekly mode still forces it", () => {
    expect(at("2026-10-09T16:13:00Z", quiet, { ...slot, enabled: false }).runWeekly).toBe(false);
    const forced = decideRun({
      now: new Date("2026-10-07T05:13:00Z"),
      mode: "weekly",
      lastRun: lastWith(),
      force: false,
      weekly: { ...slot, enabled: false },
    });
    expect(forced).toMatchObject({ due: false, runWeekly: true });
  });

  it("uses the Stockholm hour across the changeover", () => {
    // Sunday 25 October 2026, after the clocks went back: 18:00 CET is 17:00Z.
    const sunday = { enabled: true, day: 0, hour: 18 };
    expect(at("2026-10-25T16:59:00Z", quiet, sunday).runWeekly).toBe(false);
    expect(at("2026-10-25T17:00:00Z", quiet, sunday).runWeekly).toBe(true);
  });
});

describe("decideRun: modes and force", () => {
  const justRan = lastWith(record("2026-10-07T05:13:00Z"));

  it("on-demand ignores the gate and never runs the weekly pass", () => {
    const decision = decideRun({
      now: new Date("2026-10-11T08:00:00Z"),
      mode: "on-demand",
      lastRun: lastWith(record("2026-10-11T05:13:00Z")),
      force: false,
    });
    expect(decision).toMatchObject({ due: true, runWeekly: false });
  });

  it("force ignores the cadence gate", () => {
    expect(scheduled("2026-10-07T15:00:00Z", justRan, true)).toMatchObject({
      due: true,
      runWeekly: false,
    });
  });

  it("force on a Sunday still adds the weekly pass only once", () => {
    const sunday = "2026-10-11T08:00:00Z";
    expect(scheduled(sunday, lastWith(record("2026-10-11T05:13:00Z")), true)).toMatchObject({
      due: true,
      runWeekly: true,
    });
    const weeklyDone = lastWith(record("2026-10-11T05:13:00Z"), record("2026-10-11T05:20:00Z"));
    expect(scheduled(sunday, weeklyDone, true)).toMatchObject({ due: true, runWeekly: false });
  });

  it("weekly mode runs only the weekly pass, on any day", () => {
    const decision = decideRun({
      now: new Date("2026-10-07T08:00:00Z"),
      mode: "weekly",
      lastRun: justRan,
      force: false,
    });
    expect(decision).toMatchObject({ due: false, runWeekly: true });
  });
});

describe("decideRun: which records count", () => {
  const now = "2026-10-07T05:13:00Z";

  it("counts a run that found nothing, so the cadence does not retry daily", () => {
    expect(
      scheduled("2026-10-06T05:13:00Z", lastWith(record("2026-10-05T05:13:00Z", "nothing"))).due,
    ).toBe(false);
  });

  it("ignores failed and gated records, so the next trigger retries", () => {
    expect(
      scheduled("2026-10-06T05:13:00Z", lastWith(record("2026-10-05T05:13:00Z", "failed"))).due,
    ).toBe(true);
    expect(
      scheduled("2026-10-06T05:13:00Z", lastWith(record("2026-10-05T05:13:00Z", "gated"))).due,
    ).toBe(true);
  });

  it("treats an unreadable timestamp as no previous run", () => {
    expect(scheduled(now, lastWith(record("not-a-date"))).due).toBe(true);
  });

  it("waits when the last digest is dated in the future", () => {
    const decision = scheduled(now, lastWith(record("2026-10-09T05:13:00Z")));
    expect(decision.due).toBe(false);
    expect(decision.reason).toMatch(/after today/);
  });

  it("explains its decision in one sentence", () => {
    expect(scheduled(now, lastWith(record("2026-10-05T05:13:00Z"))).reason).toContain("2026-10-05");
    expect(
      scheduled("2026-10-06T05:13:00Z", lastWith(record("2026-10-05T05:13:00Z"))).reason,
    ).toContain("next is due");
  });
});
