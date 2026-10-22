import { describe, expect, it } from "vitest";
import { scheduleOp } from "./podcastProfiles";

describe("scheduleOp", () => {
  const was = {
    "daily.hour": "7",
    "daily.voice": "",
    "weekly.enabled": "true",
    "weekly.day": "0",
    "weekly.length": "10",
    "weekly.voice": "",
    "weekly.voice_b": "",
  };

  it("is null while nothing differs", () => {
    expect(scheduleOp(was, { ...was })).toBeNull();
  });

  it("sends only the changed fields, each in its own profile", () => {
    const now = {
      ...was,
      "daily.hour": "9",
      "daily.voice": "v1",
      "weekly.enabled": "false",
      "weekly.day": "5",
      "weekly.voice": "v2",
      "weekly.voice_b": "v3",
    };
    expect(scheduleOp(was, now)).toEqual({
      op: "schedule.set",
      hour: 9,
      voice_id: "v1",
      weekly: { enabled: false, day: 5, voice_id: "v2", voice_id_b: "v3" },
    });
  });

  // Filed under `weekly`, the Weekly page's zone was dropped by the server as an unknown field.
  it("sends the time zone at the top of the op from either profile", () => {
    const zone = { "weekly.timezone": "Europe/Stockholm" };
    expect(scheduleOp(zone, { "weekly.timezone": "Asia/Tokyo" })).toEqual({
      op: "schedule.set",
      timezone: "Asia/Tokyo",
    });
  });

  it("turns the default voice back into null and the cadence into days", () => {
    expect(
      scheduleOp(
        { "daily.voice": "v1", "daily.cadence": "2" },
        { "daily.voice": "", "daily.cadence": "7" },
      ),
    ).toEqual({
      op: "schedule.set",
      voice_id: null,
      cadence_days: 7,
    });
  });
});
