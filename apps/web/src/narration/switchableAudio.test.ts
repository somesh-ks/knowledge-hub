import { describe, expect, it } from "vitest";
import { createHarness, FakeAudio, makeDigest } from "../player/core/testing";
import { createSwitchableAudio } from "./switchableAudio";
import { createTrackAudio } from "./trackAudio";

describe("createSwitchableAudio", () => {
  it("is the element until told otherwise", async () => {
    const element = new FakeAudio();
    const audio = createSwitchableAudio(element);
    const heard: string[] = [];
    audio.addEventListener("playing", () => heard.push("playing"));
    audio.src = "/audio/a.mp3";
    audio.playbackRate = 1.5;
    await audio.play();
    element.loadMetadata(60);
    element.startPlaying();
    expect(element.src).toBe("/audio/a.mp3");
    expect(element.playbackRate).toBe(1.5);
    expect(audio.duration).toBe(60);
    expect(audio.paused).toBe(false);
    expect(heard).toEqual(["playing"]);
    expect(audio.element).toBe(element);
  });

  it("moves its listeners to the audio it is switched to, and off the old one", () => {
    const element = new FakeAudio();
    const other = new FakeAudio();
    const audio = createSwitchableAudio(element);
    const heard: string[] = [];
    audio.addEventListener("ended", () => heard.push("ended"));
    audio.use(other);
    element.emit("ended");
    expect(heard).toEqual([]);
    other.emit("ended");
    expect(heard).toEqual(["ended"]);
    expect(element.listenerCount()).toBe(0);
  });

  it("stops calling a listener that was removed", () => {
    const element = new FakeAudio();
    const audio = createSwitchableAudio(element);
    let calls = 0;
    const listener = () => {
      calls += 1;
    };
    audio.addEventListener("pause", listener);
    audio.removeEventListener("pause", listener);
    element.emit("pause");
    expect(calls).toBe(0);
  });

  it("lets the store keep playing a file while the track adapter is slotted in", async () => {
    const element = new FakeAudio();
    const audio = createSwitchableAudio(element);
    const harness = createHarness({ createAudio: () => audio });
    const { store } = harness;
    store.load(makeDigest());
    store.play();
    await Promise.resolve();
    element.loadMetadata(120);
    element.startPlaying();
    expect(store.getState().status).toBe("playing");

    // The narration code arrives mid-play and puts the adapter in. Nothing audible changes.
    audio.use(createTrackAudio(element, { resolve: () => null }));
    expect(store.getState().status).toBe("playing");
    element.currentTime = 45;
    element.emit("timeupdate");
    harness.flushFrames();
    expect(store.getTime()).toBe(45);
    element.finish();
    expect(store.getState().status).toBe("ended");
  });
});
