import type { PlayOptions, SoundName } from "@dispatch/sound";
import { describe, expect, it } from "vitest";
import { announcementForEvent, createAnnouncer } from "../core/announcements";
import type { PlayerEvent } from "../core/playerTypes";
import { makeDigest } from "../core/testing";
import { buildTimeline } from "../core/timeline";
import {
  type CueSink,
  cueForDetent,
  cueForGenerate,
  cueForPlayerEvent,
  cueForSheet,
  cueForSwitch,
  cueForVolumeRelease,
  playCue,
} from "./soundMap";

class FakeEngine implements CueSink {
  readonly calls: Array<{ name: SoundName; options?: PlayOptions }> = [];
  play(name: SoundName, options?: PlayOptions): boolean {
    this.calls.push({ name, options });
    return true;
  }
}

function soundsFor(event: PlayerEvent): SoundName | null {
  return cueForPlayerEvent(event)?.name ?? null;
}

describe("player events to sounds", () => {
  it("cues play and pause only for what the listener pressed", () => {
    expect(soundsFor({ type: "willPlay", reason: "user" })).toBe("play");
    expect(soundsFor({ type: "willPlay", reason: "item" })).toBe("play");
    expect(soundsFor({ type: "willPlay", reason: "scrub" })).toBeNull();
    expect(soundsFor({ type: "didPause", reason: "user" })).toBe("pause");
    expect(soundsFor({ type: "didPause", reason: "scrub" })).toBeNull();
    expect(soundsFor({ type: "didPause", reason: "system" })).toBeNull();
    expect(soundsFor({ type: "didPause", reason: "load" })).toBeNull();
  });

  it("cues next and previous item, and nothing for keyboard, auto-advance, scrub or chapter taps", () => {
    expect(soundsFor({ type: "itemChanged", index: 1, cause: "skip-next" })).toBe("itemNext");
    expect(soundsFor({ type: "itemChanged", index: 0, cause: "skip-previous" })).toBe("itemPrev");
    for (const cause of ["keyboard", "auto", "scrub", "select", "seek", "load"] as const) {
      expect(soundsFor({ type: "itemChanged", index: 2, cause })).toBeNull();
    }
  });

  it("cues the speed change with the new rate, the end of a digest and errors", () => {
    expect(cueForPlayerEvent({ type: "rateChanged", rate: 1.5 })).toEqual({
      name: "speedChange",
      options: { rate: 1.5 },
    });
    expect(soundsFor({ type: "ended" })).toBe("digestEnd");
    expect(soundsFor({ type: "error", error: { kind: "network", message: "x" } })).toBe("error");
  });

  it("stays silent for interruptions and loading", () => {
    expect(soundsFor({ type: "interrupted" })).toBeNull();
    expect(soundsFor({ type: "loaded", digestId: "2026-10-07" })).toBeNull();
  });
});

describe("interface cues", () => {
  it("pitches a scrub detent by position and softens it at speed", () => {
    const slow = cueForDetent(0.4, 0.1);
    const fast = cueForDetent(0.4, 6);
    expect(slow).toEqual({ name: "scrubDetent", options: { position: 0.4, gain: 1 } });
    expect(fast.options?.gain).toBeLessThan(slow.options?.gain ?? 0);
  });

  it("maps sheets, switches, the volume sample and the Generate run", () => {
    expect(cueForSheet(true).name).toBe("sheetOpen");
    expect(cueForSheet(false).name).toBe("sheetClose");
    expect(cueForSwitch(true).name).toBe("toggleOn");
    expect(cueForSwitch(false).name).toBe("toggleOff");
    expect(cueForVolumeRelease().name).toBe("toggleOn");
    expect(cueForGenerate("started").name).toBe("generateStart");
    expect(cueForGenerate("finished").name).toBe("generateDone");
    expect(cueForGenerate("failed").name).toBe("error");
  });

  it("plays through the engine, and is a no-op without one or without a cue", () => {
    const engine = new FakeEngine();
    expect(playCue(engine, cueForSheet(true))).toBe(true);
    expect(playCue(engine, null)).toBe(false);
    expect(playCue(null, cueForSheet(true))).toBe(false);
    expect(engine.calls).toEqual([{ name: "sheetOpen", options: undefined }]);
  });

  it("never maps anything to a sound that the sound design does not list", () => {
    const names = new Set<SoundName>([
      "play",
      "pause",
      "itemNext",
      "itemPrev",
      "scrubDetent",
      "speedChange",
      "sheetOpen",
      "sheetClose",
      "generateStart",
      "generateDone",
      "error",
      "toggleOn",
      "toggleOff",
      "digestEnd",
    ]);
    const mapped = [
      cueForSheet(true),
      cueForSwitch(false),
      cueForGenerate("failed"),
      cueForDetent(0.2, 0),
      ...(["willPlay", "didPause"] as const).map((type) =>
        cueForPlayerEvent(
          type === "willPlay"
            ? { type: "willPlay", reason: "user" }
            : { type: "didPause", reason: "user" },
        ),
      ),
    ];
    for (const cue of mapped) expect(cue && names.has(cue.name)).toBe(true);
  });
});

describe("announcements", () => {
  const track = { digest: makeDigest(), timeline: buildTimeline(makeDigest()) };

  it("announces what the listener did, and not what the narrator is already saying", () => {
    expect(announcementForEvent({ type: "willPlay", reason: "user" }, track)).toBe("Playing.");
    expect(announcementForEvent({ type: "willPlay", reason: "item" }, track)).toBeNull();
    expect(announcementForEvent({ type: "didPause", reason: "user" }, track)).toBe("Paused.");
    expect(announcementForEvent({ type: "didPause", reason: "scrub" }, track)).toBeNull();
    expect(announcementForEvent({ type: "itemChanged", index: 1, cause: "skip-next" }, track)).toBe(
      "Item 2 of 4: The safe triangle, rebuilt",
    );
    expect(
      announcementForEvent({ type: "itemChanged", index: 1, cause: "auto" }, track),
    ).toBeNull();
    expect(
      announcementForEvent({ type: "itemChanged", index: 1, cause: "keyboard" }, track),
    ).toBeNull();
  });

  it("announces speed, the end and errors in plain words", () => {
    expect(announcementForEvent({ type: "rateChanged", rate: 1.25 }, track)).toBe("Speed 1.25x.");
    expect(announcementForEvent({ type: "ended" }, track)).toBe("Briefing finished.");
    expect(
      announcementForEvent(
        { type: "error", error: { kind: "network", message: "Audio did not load." } },
        track,
      ),
    ).toBe("Audio did not load.");
    expect(announcementForEvent({ type: "interrupted" }, track)).toMatch(/interrupted/);
  });

  it("alternates two regions and clears each before reuse so no message is dropped", () => {
    const regions: [{ textContent: string | null }, { textContent: string | null }] = [
      { textContent: null },
      { textContent: null },
    ];
    const scheduled: Array<() => void> = [];
    const announcer = createAnnouncer(
      () => regions,
      (callback) => {
        scheduled.push(callback);
      },
    );
    announcer.announce("Playing.");
    announcer.announce("Item 2 of 4: The safe triangle");
    expect(regions[0].textContent).toBe("");
    expect(regions[1].textContent).toBe("");
    for (const callback of scheduled) callback();
    expect(regions[0].textContent).toBe("Playing.");
    expect(regions[1].textContent).toBe("Item 2 of 4: The safe triangle");
    announcer.announce("Paused.");
    expect(regions[0].textContent).toBe("");
  });
});
