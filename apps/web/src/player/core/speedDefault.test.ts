import { describe, expect, it } from "vitest";
import { createPreferencesStore } from "./preferences";
import { createSpeedDefault } from "./speedDefault";
import { createHarness, MemoryStorage, makeDigest } from "./testing";

function setup() {
  const storage = new MemoryStorage();
  const preferences = createPreferencesStore({ storage, defaultSounds: () => true });
  const speed = createSpeedDefault({ storage, preferences });
  return { storage, preferences, speed };
}

describe("speed default", () => {
  it("starts the next episode at the default after a speed chosen in the last one", () => {
    const { speed } = setup();
    let current = "ep-1";
    const harness = createHarness({
      getPreferredRate: speed.getDefaultRate,
      onRateChange: (rate) => speed.noteRate(current, rate),
    });
    harness.store.load(makeDigest({ id: "ep-1" }));
    harness.store.setRate(1.5);
    current = "ep-2";
    harness.store.load(makeDigest({ id: "ep-2" }));
    expect(harness.store.getState().rate).toBe(1);
  });

  it("offers the third episode's speed once, and never again after Not now", () => {
    const { speed, storage, preferences } = setup();
    for (const id of ["a", "b"]) speed.noteRate(id, 1.5);
    expect(speed.getPending()).toBeNull();
    speed.noteRate("c", 1.5);
    speed.flush();
    expect(speed.getPending()).toBe(1.5);
    speed.dismiss();
    speed.noteRate("d", 1.5);
    speed.flush();
    speed.noteEnded(1.5);
    expect(speed.getPending()).toBeNull();
    // A reload keeps the answer.
    const again = createSpeedDefault({ storage, preferences });
    again.noteEnded(1.5);
    expect(again.getPending()).toBeNull();
  });

  it("counts only the speed an episode was left at, not the slider steps passed on the way", () => {
    const { speed } = setup();
    // Three episodes dragged through 1.5 on the way to 2: 1.5 was never anyone's speed.
    for (const id of ["a", "b", "c"]) {
      speed.noteRate(id, 1.25);
      speed.noteRate(id, 1.5);
      speed.noteRate(id, 2);
    }
    speed.flush();
    expect(speed.getPending()).toBe(2);
    speed.dismiss();
    // 1.5 and 1.25 were never counted, so each still needs its own three episodes.
    speed.noteRate("d", 1.5);
    speed.flush();
    expect(speed.getPending()).toBeNull();
  });

  it("offers when an episode ends off the default, and Make default saves it", () => {
    const { speed, preferences } = setup();
    speed.noteEnded(1);
    expect(speed.getPending()).toBeNull();
    speed.noteEnded(1.25);
    expect(speed.getPending()).toBe(1.25);
    speed.accept();
    expect(preferences.get().rate).toBe(1.25);
    expect(speed.getPending()).toBeNull();
  });
});
