import { describe, expect, it, vi } from "vitest";
import { type EarlyPlay, replayEarlyTap, takeEarlyAudio } from "./earlyTap";

function chip(state = "preparing", connected = true) {
  const attributes = new Map<string, string>([["aria-busy", "true"]]);
  return {
    dataset: { state } as DOMStringMap,
    isConnected: connected,
    click: vi.fn(),
    getAttribute: (name: string) => attributes.get(name) ?? null,
    removeAttribute: (name: string) => attributes.delete(name),
    attributes,
  };
}

describe("replayEarlyTap", () => {
  it("presses a control tapped before the player loaded, put back as it was", () => {
    const pressed = chip();
    const stop = vi.fn();
    const early = {
      chip: pressed as unknown as HTMLElement,
      state: "idle",
      audio: null,
      stop,
    } satisfies EarlyPlay;
    replayEarlyTap({ dispatchEarlyPlay: early });
    expect(stop).toHaveBeenCalledOnce();
    expect(pressed.click).toHaveBeenCalledOnce();
    expect(pressed.dataset.state).toBe("idle");
    expect(pressed.attributes.has("aria-busy")).toBe(false);
    // Once only: a second start of the runtime presses nothing.
    replayEarlyTap({ dispatchEarlyPlay: early });
    expect(pressed.click).toHaveBeenCalledOnce();
  });

  it("presses nothing that is gone or disabled, and stops listening all the same", () => {
    for (const pressed of [chip("preparing", false), chip()]) {
      if (pressed.isConnected) pressed.attributes.set("aria-disabled", "true");
      const stop = vi.fn();
      replayEarlyTap({
        dispatchEarlyPlay: {
          chip: pressed as unknown as HTMLElement,
          state: "idle",
          audio: null,
          stop,
        },
      });
      expect(stop).toHaveBeenCalledOnce();
      expect(pressed.click).not.toHaveBeenCalled();
    }
  });

  it("does nothing without the inline script", () => {
    expect(() => replayEarlyTap({})).not.toThrow();
  });
});

describe("takeEarlyAudio", () => {
  it("hands the unlocked element over once", () => {
    const audio = {} as HTMLAudioElement;
    const scope = { dispatchEarlyPlay: { chip: null, state: null, audio } };
    expect(takeEarlyAudio(scope)).toBe(audio);
    expect(takeEarlyAudio(scope)).toBeNull();
    expect(takeEarlyAudio({})).toBeNull();
  });
});
