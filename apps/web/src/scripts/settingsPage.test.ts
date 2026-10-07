import { describe, expect, it } from "vitest";
import { PLAYBACK_RATES } from "../player/core/playerTypes";
import { DEFAULT_PREFERENCES, THEME_PREFERENCES } from "../player/core/preferences";
import {
  changeSounds,
  controlState,
  toRate,
  toTheme,
  toVolume,
  volumePercent,
} from "./settingsPage";

describe("toTheme", () => {
  it("accepts every theme the store knows", () => {
    for (const theme of THEME_PREFERENCES) expect(toTheme(theme)).toBe(theme);
  });

  it("rejects anything else", () => {
    expect(toTheme("sepia")).toBeNull();
    expect(toTheme("")).toBeNull();
    expect(toTheme("Dark")).toBeNull();
  });
});

describe("toRate", () => {
  it("matches a radio's text against the playback rates", () => {
    for (const rate of PLAYBACK_RATES) expect(toRate(String(rate))).toBe(rate);
  });

  it("rejects a speed the player does not offer", () => {
    expect(toRate("3")).toBeNull();
    expect(toRate("1.0")).toBeNull();
    expect(toRate("")).toBeNull();
  });
});

describe("toVolume", () => {
  it("reads a slider's value", () => {
    expect(toVolume("0.35")).toBe(0.35);
    expect(toVolume("0")).toBe(0);
    expect(toVolume("1")).toBe(1);
  });

  it("keeps the volume between silent and full", () => {
    expect(toVolume("-0.2")).toBe(0);
    expect(toVolume("4")).toBe(1);
  });

  it("returns null for a value that is not a number", () => {
    expect(toVolume("")).toBeNull();
    expect(toVolume("  ")).toBeNull();
    expect(toVolume("loud")).toBeNull();
    expect(toVolume("Infinity")).toBeNull();
  });
});

describe("volumePercent", () => {
  it("writes the volume as a whole percentage", () => {
    expect(volumePercent(0)).toBe("0%");
    expect(volumePercent(0.8)).toBe("80%");
    expect(volumePercent(1)).toBe("100%");
  });

  it("rounds away the noise of a 0.05 step", () => {
    expect(volumePercent(0.7000000000000001)).toBe("70%");
    expect(volumePercent(0.15)).toBe("15%");
  });

  it("stays inside the track for a value out of range", () => {
    expect(volumePercent(-1)).toBe("0%");
    expect(volumePercent(2)).toBe("100%");
  });
});

describe("controlState", () => {
  it("shows the defaults", () => {
    expect(controlState(DEFAULT_PREFERENCES, true)).toEqual({
      theme: "system",
      rate: "1",
      sounds: true,
      volume: "0.8",
      volumePercent: "80%",
      volumeDisabled: false,
    });
  });

  it("checks the radio whose value is the stored speed", () => {
    for (const rate of PLAYBACK_RATES) {
      const state = controlState({ ...DEFAULT_PREFERENCES, rate }, true);
      expect(toRate(state.rate)).toBe(rate);
    }
  });

  it("takes sounds from the resolved setting, not from the unset preference", () => {
    // `sounds` is null until the reader chooses; reduced motion resolves that to off.
    const state = controlState({ ...DEFAULT_PREFERENCES, sounds: null }, false);
    expect(state.sounds).toBe(false);
    expect(state.volumeDisabled).toBe(true);
  });

  it("keeps the slider at its level while sounds are off", () => {
    const state = controlState({ ...DEFAULT_PREFERENCES, sounds: false, volume: 0.35 }, false);
    expect(state.volume).toBe("0.35");
    expect(state.volumePercent).toBe("35%");
    expect(state.volumeDisabled).toBe(true);
  });
});

describe("changeSounds", () => {
  function record() {
    const calls: string[] = [];
    return {
      calls,
      sink: {
        setSounds: (enabled: boolean) => calls.push(`set ${enabled}`),
        play: (cue: { name: string }) => calls.push(`play ${cue.name}`),
      },
    };
  }

  it("turns sounds on before the cue, so the engine is allowed to play it", () => {
    const { calls, sink } = record();
    changeSounds(true, sink);
    expect(calls).toEqual(["set true", "play toggleOn"]);
  });

  it("plays the cue before turning sounds off, as a last confirmation", () => {
    const { calls, sink } = record();
    changeSounds(false, sink);
    expect(calls).toEqual(["play toggleOff", "set false"]);
  });
});
