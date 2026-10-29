import type { LastRunFile, RunRecord } from "@singularity/core";
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

  it("runs the weekly pass on a Sunday, and a podcast due that day waits", () => {
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

  it("makes no podcast on the weekly day, before or after the weekly hour", () => {
    expect(at("2026-10-11T05:13:00Z", lastWith(friday))).toMatchObject({
      due: false,
      runWeekly: false,
      reason: "today is the weekly podcast's day; no daily podcast",
    });
    expect(at("2026-10-11T16:10:00Z", lastWith(friday))).toMatchObject({
      due: false,
      runWeekly: true,
    });
  });

  it("counts the cadence from the weekly podcast, so the next podcast keeps its spacing", () => {
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

  it("leaves Sunday to the podcast while the weekly podcast is off", () => {
    expect(at("2026-10-11T05:13:00Z", lastWith(friday), { ...slot, enabled: false }).due).toBe(
      true,
    );
  });

  it("still runs a podcast the owner asks for", () => {
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

  it("is due on its day from the two hours before its slot, independent of the daily cadence", () => {
    expect(at("2026-10-09T13:59:00Z", quiet).runWeekly).toBe(false);
    expect(at("2026-10-09T14:00:00Z", quiet)).toMatchObject({ due: false, runWeekly: true });
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
    expect(at("2026-10-25T14:59:00Z", quiet, sunday).runWeekly).toBe(false);
    expect(at("2026-10-25T15:00:00Z", quiet, sunday).runWeekly).toBe(true);
  });
});

// The gate counted in Stockholm whatever zone was chosen, so New York at 07:00 ran at 07:00 in Stockholm (D89).
describe("decideRun: the schedule's time zone", () => {
  const SUNDAY_7 = { enabled: true, day: 0, hour: 7 };
  const inNewYork = (now: string, last: LastRunFile, weekly = SUNDAY_7) =>
    decideRun({
      now: new Date(now),
      mode: "scheduled",
      lastRun: last,
      force: false,
      weekly,
      zone: "America/New_York",
    });

  it("reads the weekly slot's day and hour on the zone's clock", () => {
    // 04:30 Sunday in New York is 10:30 in Stockholm: before the hour that starts the slot (05:00).
    expect(inNewYork("2026-10-11T08:30:00Z", lastWith()).runWeekly).toBe(false);
    expect(inNewYork("2026-10-11T09:30:00Z", lastWith()).runWeekly).toBe(true);
    // 22:00 Sunday in New York is already Monday in Stockholm.
    expect(inNewYork("2026-10-12T02:00:00Z", lastWith())).toMatchObject({
      runWeekly: true,
      date: "2026-10-11",
    });
  });

  it("counts the cadence between the zone's dates", () => {
    // The last run was late on 9 October in New York, already the 10th in Stockholm.
    const last = lastWith(record("2026-10-10T03:00:00Z"));
    const decision = inNewYork("2026-10-11T12:00:00Z", last, NO_WEEKLY);
    expect(decision).toMatchObject({ due: true, date: "2026-10-11" });
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

describe("decideRun: generate ahead, publish at the scheduled hour", () => {
  // Sunday 25 October 2026, 07:00 Stockholm is 06:00Z (the clocks went back that night).
  const slot = { enabled: true, day: 0, hour: 7 };
  const at = (now: string, last: LastRunFile = lastWith()) =>
    decideRun({ now: new Date(now), mode: "scheduled", lastRun: last, force: false, weekly: slot });

  it("starts the weekly pass two hours before its slot and commits a deploy lead before it", () => {
    expect(at("2026-10-25T05:20:00Z")).toMatchObject({
      runWeekly: true,
      publishAt: new Date("2026-10-25T05:57:00Z"),
    });
  });

  it("does not start three hours ahead", () => {
    expect(at("2026-10-25T03:50:00Z")).toMatchObject({ runWeekly: false, publishAt: null });
  });

  it("publishes a late start at once: the instant is already past", () => {
    const late = at("2026-10-25T08:47:00Z");
    expect(late.runWeekly).toBe(true);
    expect(late.publishAt?.getTime()).toBeLessThan(Date.parse("2026-10-25T08:47:00Z"));
  });

  it("keeps the double-run protection: a pass that published today is not due again", () => {
    const done = lastWith(undefined, record("2026-10-25T06:00:30Z"));
    expect(at("2026-10-25T06:30:00Z", done)).toMatchObject({ runWeekly: false, publishAt: null });
  });

  it("gives the daily podcast its publish time when the schedule's hour is known", () => {
    const daily = decideRun({
      now: new Date("2026-10-27T05:30:00Z"),
      mode: "scheduled",
      lastRun: lastWith(record("2026-10-24T06:00:00Z")),
      force: false,
      weekly: NO_WEEKLY,
      hour: 7,
    });
    expect(daily).toMatchObject({ due: true, publishAt: new Date("2026-10-27T05:57:00Z") });
  });
});

describe("decideRun: a daily podcast that is switched off", () => {
  const daily = (dailyEnabled: boolean) =>
    decideRun({
      now: new Date("2026-10-27T05:30:00Z"),
      mode: "scheduled",
      lastRun: lastWith(record("2026-10-24T06:00:00Z")),
      force: false,
      weekly: NO_WEEKLY,
      hour: 7,
      dailyEnabled,
    });

  it("is not due at its hour, so it is never generated or published", () => {
    expect(daily(true)).toMatchObject({ due: true });
    expect(daily(false)).toMatchObject({ due: false, runWeekly: false, publishAt: null });
  });

  it("stays off under a forced run, which bypasses the cadence only", () => {
    const forced = decideRun({
      now: new Date("2026-10-27T05:30:00Z"),
      mode: "scheduled",
      lastRun: lastWith(record("2026-10-26T06:00:00Z")),
      force: true,
      weekly: NO_WEEKLY,
      hour: 7,
      dailyEnabled: false,
    });
    expect(forced).toMatchObject({ due: false, publishAt: null });
  });

  it("leaves the weekly pass and an on-demand episode alone", () => {
    const sunday = decideRun({
      now: new Date("2026-10-25T06:30:00Z"),
      mode: "scheduled",
      lastRun: lastWith(),
      force: false,
      weekly: { enabled: true, day: 0, hour: 7 },
      dailyEnabled: false,
    });
    expect(sunday.runWeekly).toBe(true);
    const onDemand = decideRun({
      now: new Date("2026-10-27T05:30:00Z"),
      mode: "on-demand",
      lastRun: lastWith(),
      force: false,
      dailyEnabled: false,
    });
    expect(onDemand.due).toBe(true);
  });
});

describe("decideRun: the commit time on a daylight saving day", () => {
  const slot = { enabled: true, day: 0, hour: 7 };
  const at = (now: string) =>
    decideRun({
      now: new Date(now),
      mode: "scheduled",
      lastRun: lastWith(),
      force: false,
      weekly: slot,
    });

  // Both days are Sundays. 07:00 is 05:00Z after the spring change (CEST, 29 March) and 06:00Z
  // after the autumn one (CET, 25 October); the commit goes three minutes before it.
  it.each([
    ["spring forward, started two hours ahead", "2026-03-29T03:10:00Z", "2026-03-29T04:57:00Z"],
    ["fall back, started two hours ahead", "2026-10-25T04:10:00Z", "2026-10-25T05:57:00Z"],
    ["fall back, started late", "2026-10-25T07:30:00Z", "2026-10-25T05:57:00Z"],
  ])("commits at the local slot less the lead: %s", (_name, now, commit) => {
    expect(at(now)).toMatchObject({ runWeekly: true, publishAt: new Date(commit) });
  });
});
