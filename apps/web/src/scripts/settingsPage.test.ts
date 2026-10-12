import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, THEME_PREFERENCES } from "../player/core/preferences";
import { changeSounds, controlState, toTheme, toVolume, volumePercent } from "./settingsPage";

describe("toTheme", () => {
  it("accepts every theme the store knows", () => {
    for (const theme of THEME_PREFERENCES) expect(toTheme(theme)).toBe(theme);
  });

  it.each(["sepia", "", "Dark"])("rejects %j", (value) => {
    expect(toTheme(value)).toBeNull();
  });
});

describe("toVolume", () => {
  it.each<[string, number | null]>([
    ["0.35", 0.35],
    ["0", 0],
    ["1", 1],
    ["-0.2", 0],
    ["4", 1],
    ["", null],
    ["  ", null],
    ["loud", null],
    ["Infinity", null],
  ])("reads %j as %s", (value, expected) => {
    expect(toVolume(value)).toBe(expected);
  });
});

describe("volumePercent", () => {
  it.each<[number, string]>([
    [0, "0%"],
    [0.8, "80%"],
    [1, "100%"],
    [0.7000000000000001, "70%"],
    [0.15, "15%"],
    [-1, "0%"],
    [2, "100%"],
  ])("writes %s as %s", (value, expected) => {
    expect(volumePercent(value)).toBe(expected);
  });
});

describe("controlState", () => {
  it("shows the defaults", () => {
    expect(controlState(DEFAULT_PREFERENCES, true)).toEqual({
      theme: "system",
      sounds: true,
      volume: "0.8",
      volumePercent: "80%",
      volumeDisabled: false,
    });
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
