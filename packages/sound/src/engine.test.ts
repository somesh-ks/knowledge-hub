import { describe, expect, it, vi } from "vitest";
import { createSoundEngine, defaultSoundsEnabled, installGestureUnlock } from "./engine.js";
import { dbToGain, MAX_POLYPHONY, SOUND_NAMES, type SoundName, volumeToGain } from "./recipes.js";

/* A minimal fake of the Web Audio surface the engine touches. Cast once at the seam. */

class FakeParam {
  value = 0;
  readonly calls: Array<[string, ...number[]]> = [];
  setValueAtTime(value: number, time: number): void {
    this.calls.push(["set", value, time]);
  }
  exponentialRampToValueAtTime(value: number, time: number): void {
    this.calls.push(["exp", value, time]);
  }
  cancelScheduledValues(time: number): void {
    this.calls.push(["cancel", time]);
  }
  setTargetAtTime(value: number, time: number, constant: number): void {
    this.calls.push(["target", value, time, constant]);
  }
}

class FakeNode {
  connected: FakeNode[] = [];
  connect(node: FakeNode): FakeNode {
    this.connected.push(node);
    return node;
  }
  disconnect(): void {
    this.connected = [];
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

class FakeSource extends FakeNode {
  onended: (() => void) | null = null;
  readonly started: number[] = [];
  readonly stopped: Array<number | undefined> = [];
  buffer: unknown = null;
  type = "sine";
  readonly frequency = new FakeParam();
  readonly detune = new FakeParam();
  start(time?: number): void {
    this.started.push(time ?? 0);
  }
  stop(time?: number): void {
    this.stopped.push(time);
  }
}

class FakeBiquad extends FakeNode {
  type = "lowpass";
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
}

class FakeCompressor extends FakeNode {
  readonly threshold = new FakeParam();
  readonly knee = new FakeParam();
  readonly ratio = new FakeParam();
  readonly attack = new FakeParam();
  readonly release = new FakeParam();
}

class FakeContext {
  currentTime = 0;
  state = "suspended";
  sampleRate = 48000;
  closed = false;
  resumeCalls = 0;
  readonly destination = new FakeNode();
  readonly gains: FakeGain[] = [];
  readonly sources: FakeSource[] = [];
  resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = "running";
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closed = true;
    this.state = "closed";
    return Promise.resolve();
  }
  createGain(): FakeGain {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  }
  createOscillator(): FakeSource {
    const node = new FakeSource();
    this.sources.push(node);
    return node;
  }
  createBufferSource(): FakeSource {
    const node = new FakeSource();
    this.sources.push(node);
    return node;
  }
  createBuffer(_channels: number, length: number): { getChannelData: () => Float32Array } {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  createBiquadFilter(): FakeBiquad {
    return new FakeBiquad();
  }
  createDynamicsCompressor(): FakeCompressor {
    return new FakeCompressor();
  }
}

interface Harness {
  engine: ReturnType<typeof createSoundEngine>;
  context: FakeContext;
  created: () => number;
  state: { enabled: boolean; volume: number; narrating: boolean; hidden: boolean; clock: number };
}

function harness(): Harness {
  const context = new FakeContext();
  let created = 0;
  const state = { enabled: true, volume: 1, narrating: false, hidden: false, clock: 1000 };
  const engine = createSoundEngine({
    isEnabled: () => state.enabled,
    getVolume: () => state.volume,
    isNarrationPlaying: () => state.narrating,
    isHidden: () => state.hidden,
    createContext: () => {
      created += 1;
      return context as unknown as AudioContext;
    },
    now: () => state.clock,
  });
  return { engine, context, created: () => created, state };
}

/** The per-voice output gain is the first gain created for a voice, after the master input. */
function voiceGainValues(context: FakeContext): number[] {
  return context.gains
    .filter((gain) => gain.gain.value > 0 && gain.connected.length > 0)
    .map((gain) => gain.gain.value);
}

describe("audio session", () => {
  function withSession() {
    const session = { type: "auto" };
    const state = { enabled: true };
    const engine = createSoundEngine({
      isEnabled: () => state.enabled,
      getVolume: () => 1,
      isNarrationPlaying: () => false,
      isHidden: () => false,
      createContext: () => new FakeContext() as unknown as AudioContext,
      now: () => 1000,
      getAudioSession: () => session,
    });
    return { engine, session, state };
  }

  it("takes the playback session only while Sounds is on, so a listener with Sounds off keeps other apps' audio", () => {
    const { engine, session, state } = withSession();
    state.enabled = false;
    engine.unlock();
    expect(session.type).toBe("auto");
    // Switching Sounds on plays its confirmation cue: the session must be ready for it.
    state.enabled = true;
    expect(engine.play("toggleOn")).toBe(true);
    expect(session.type).toBe("playback");
    // Switching Sounds off gives the session back at the next gesture.
    state.enabled = false;
    engine.unlock();
    expect(session.type).toBe("auto");
  });
});

describe("lazy context", () => {
  it("creates no AudioContext until unlock, and exactly one after repeated unlocks", () => {
    const { engine, created } = harness();
    expect(created()).toBe(0);
    expect(engine.play("play")).toBe(false);
    expect(created()).toBe(0);
    engine.unlock();
    engine.unlock();
    engine.unlock();
    expect(created()).toBe(1);
  });

  it("resumes a suspended context on unlock", () => {
    const { engine, context } = harness();
    engine.unlock();
    expect(context.resumeCalls).toBe(1);
    expect(context.state).toBe("running");
  });

  it("survives a context that refuses to construct", () => {
    const engine = createSoundEngine({
      isEnabled: () => true,
      getVolume: () => 1,
      isNarrationPlaying: () => false,
      isHidden: () => false,
      createContext: () => {
        throw new Error("blocked");
      },
    });
    expect(() => engine.unlock()).not.toThrow();
    expect(engine.play("play")).toBe(false);
  });
});

describe("gates", () => {
  it("plays when everything allows it", () => {
    const { engine, context } = harness();
    engine.unlock();
    expect(engine.play("play")).toBe(true);
    expect(context.sources.length).toBeGreaterThan(1);
    expect(engine.activeVoices()).toBe(1);
  });

  it("is silent when the switch is off", () => {
    const { engine, state } = harness();
    engine.unlock();
    state.enabled = false;
    expect(engine.play("play")).toBe(false);
    expect(engine.activeVoices()).toBe(0);
  });

  it("never plays while the document is hidden", () => {
    const { engine, state } = harness();
    engine.unlock();
    state.hidden = true;
    expect(engine.play("itemNext")).toBe(false);
  });

  it("is silent at zero volume", () => {
    const { engine, state } = harness();
    engine.unlock();
    state.volume = 0;
    expect(engine.play("itemNext")).toBe(false);
  });

  it("drops the call and asks to resume when the context is suspended or interrupted", () => {
    const { engine, context } = harness();
    engine.unlock();
    context.resumeCalls = 0;
    for (const state of ["suspended", "interrupted"]) {
      context.state = state;
      expect(engine.play("play")).toBe(false);
    }
    expect(context.resumeCalls).toBe(2);
    expect(engine.activeVoices()).toBe(0);
  });

  it("plays the cue that woke a suspended context once the resume lands, unless it went stale", async () => {
    const { engine, context, state } = harness();
    engine.unlock();
    context.state = "suspended";
    expect(engine.play("itemNext")).toBe(false);
    await Promise.resolve();
    expect(engine.activeVoices()).toBe(1);

    state.clock += 1_000;
    context.state = "suspended";
    expect(engine.play("itemPrev")).toBe(false);
    state.clock += 400;
    await Promise.resolve();
    expect(engine.activeVoices()).toBe(1);
  });

  it("rate limits a repeat of the same sound but not a different one", () => {
    const { engine, state } = harness();
    engine.unlock();
    expect(engine.play("itemNext")).toBe(true);
    state.clock += 20;
    expect(engine.play("itemNext")).toBe(false);
    expect(engine.play("pause")).toBe(true);
    state.clock += 200;
    expect(engine.play("itemNext")).toBe(true);
  });
});

describe("narration", () => {
  it("skips sounds that bracket narration while it plays", () => {
    const { engine, state } = harness();
    engine.unlock();
    state.narrating = true;
    for (const name of ["play", "pause", "sheetOpen", "sheetClose"] as const) {
      expect(engine.play(name), name).toBe(false);
    }
  });

  it("ducks the rest by their declared amount", () => {
    const { engine, context, state } = harness();
    engine.unlock();
    state.narrating = true;
    expect(engine.play("itemNext")).toBe(true);
    const gains = voiceGainValues(context);
    expect(gains).toContainEqual(expect.closeTo(volumeToGain(1) * dbToGain(-9), 5));
  });

  it("plays at full level when narration is silent", () => {
    const { engine, context } = harness();
    engine.unlock();
    expect(engine.play("itemNext")).toBe(true);
    expect(voiceGainValues(context)).toContainEqual(expect.closeTo(1, 5));
  });

  it("applies the master volume taper and the per-call gain", () => {
    const { engine, context, state } = harness();
    engine.unlock();
    state.volume = 0.5;
    expect(engine.play("itemNext", { gain: 0.5 })).toBe(true);
    expect(voiceGainValues(context)).toContainEqual(expect.closeTo(0.25 * 0.5, 5));
  });
});

describe("polyphony", () => {
  it("never holds more than four voices and fades out the oldest to make room", () => {
    const { engine, context, state } = harness();
    engine.unlock();
    const names: SoundName[] = [
      "play",
      "pause",
      "itemNext",
      "itemPrev",
      "speedChange",
      "toggleOn",
      "toggleOff",
    ];
    for (const name of names) {
      state.clock += 400;
      engine.play(name);
      expect(engine.activeVoices()).toBeLessThanOrEqual(MAX_POLYPHONY);
    }
    expect(engine.activeVoices()).toBe(MAX_POLYPHONY);
    const fades = context.gains.filter((gain) =>
      gain.gain.calls.some(([kind]) => kind === "target"),
    );
    expect(fades.length).toBe(names.length - MAX_POLYPHONY);
  });

  it("forgets voices once their time is up", () => {
    const { engine, context, state } = harness();
    engine.unlock();
    engine.play("play");
    expect(engine.activeVoices()).toBe(1);
    context.currentTime += 1;
    expect(engine.activeVoices()).toBe(0);
    state.clock += 400;
    expect(engine.play("pause")).toBe(true);
  });
});

describe("scheduling", () => {
  it("starts every envelope at the floor and ends at the floor, so nothing clicks", () => {
    const { engine, context } = harness();
    engine.unlock();
    engine.play("generateDone");
    const envelopes = context.gains.filter((gain) => gain.gain.calls.length === 3);
    expect(envelopes.length).toBeGreaterThan(4);
    for (const envelope of envelopes) {
      const [first, , last] = envelope.gain.calls;
      expect(first?.[1]).toBeCloseTo(0.0001, 6);
      expect(last?.[1]).toBeCloseTo(0.0001, 6);
    }
  });

  it("points the scrub tick at the pentatonic ladder", () => {
    const { engine, context } = harness();
    engine.unlock();
    engine.play("scrubDetent", { position: 1 });
    const oscillator = context.sources.find((source) => source.frequency.calls.length > 0);
    expect(oscillator?.frequency.calls[0]?.[1]).toBeCloseTo(880, 1);
  });

  it("starts the second note of the signature after the first", () => {
    const { engine, context } = harness();
    engine.unlock();
    engine.play("generateDone");
    // Layer sources register onended; the silent unlock buffer does not.
    const starts = context.sources
      .filter((source) => source.onended !== null)
      .map((source) => source.started[0] ?? 0);
    expect(Math.max(...starts) - Math.min(...starts)).toBeCloseTo(0.12, 3);
  });

  it("stops every layer source after it starts, so none outlives its envelope", () => {
    const { engine, context } = harness();
    engine.unlock();
    engine.play("play");
    const layerSources = context.sources.filter((source) => source.onended !== null);
    expect(layerSources.length).toBeGreaterThan(1);
    for (const source of layerSources) {
      expect(source.stopped).toHaveLength(1);
      expect(source.stopped[0] ?? 0).toBeGreaterThan(source.started[0] ?? 0);
    }
  });

  it("disconnects a voice when its last source ends", () => {
    const { engine, context } = harness();
    engine.unlock();
    engine.play("play");
    const layerSources = context.sources.filter((source) => source.onended !== null);
    expect(layerSources.length).toBeGreaterThan(0);
    for (const source of layerSources) source.onended?.();
    const voice = context.gains.find((gain) => gain.gain.value > 0 && gain.gain.calls.length === 0);
    expect(voice?.connected ?? []).toEqual([]);
  });
});

describe("lifecycle", () => {
  it("closes the context and goes silent on dispose", () => {
    const { engine, context } = harness();
    engine.unlock();
    engine.play("play");
    engine.dispose();
    expect(context.closed).toBe(true);
    expect(engine.play("pause")).toBe(false);
    expect(engine.activeVoices()).toBe(0);
    engine.unlock();
    expect(context.resumeCalls).toBe(1);
  });

  it("covers every sound name without throwing", () => {
    const { engine, state } = harness();
    engine.unlock();
    for (const name of SOUND_NAMES) {
      state.clock += 2000;
      expect(() => engine.play(name, { position: 0.4, rate: 1.5 })).not.toThrow();
    }
  });
});

describe("helpers", () => {
  it("unlocks on the first gesture and stops listening when disposed", () => {
    const target = new EventTarget();
    const unlock = vi.fn();
    const dispose = installGestureUnlock({ unlock }, target);
    target.dispatchEvent(new Event("pointerdown"));
    target.dispatchEvent(new Event("keydown"));
    expect(unlock).toHaveBeenCalledTimes(2);
    dispose();
    target.dispatchEvent(new Event("pointerdown"));
    expect(unlock).toHaveBeenCalledTimes(2);
  });

  it("unlocks inside the events iOS and Android accept as an activation", () => {
    const target = new EventTarget();
    const unlock = vi.fn();
    installGestureUnlock({ unlock }, target);
    for (const type of ["touchend", "pointerup", "click"]) {
      const before = unlock.mock.calls.length;
      target.dispatchEvent(new Event(type));
      expect(unlock.mock.calls.length, type).toBe(before + 1);
    }
  });

  it("asks iOS to play through the silent switch", () => {
    const session = { type: "auto" };
    vi.stubGlobal("navigator", { audioSession: session });
    harness().engine.unlock();
    vi.unstubAllGlobals();
    expect(session.type).toBe("playback");
  });

  it("defaults sounds off for people who asked for reduced motion", () => {
    expect(defaultSoundsEnabled(() => ({ matches: true }))).toBe(false);
    expect(defaultSoundsEnabled(() => ({ matches: false }))).toBe(true);
    expect(defaultSoundsEnabled(undefined)).toBe(true);
  });
});
