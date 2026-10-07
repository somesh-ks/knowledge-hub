import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachMediaSession, type MediaSessionLike, trackMetadata } from "./mediaSession";
import { SKIP_BACK_SECONDS, SKIP_FORWARD_SECONDS } from "./playerTypes";
import { createHarness, makeDigest } from "./testing";

type Handler = (details: MediaSessionActionDetails) => void;

class FakeSession {
  metadata: MediaMetadata | null = null;
  playbackState: MediaSessionPlaybackState = "none";
  readonly handlers = new Map<string, Handler | null>();
  readonly positions: Array<MediaPositionState | undefined> = [];
  setActionHandler(action: string, handler: Handler | null): void {
    this.handlers.set(action, handler);
  }
  setPositionState(state?: MediaPositionState): void {
    this.positions.push(state);
  }
  fire(action: string, details: Partial<MediaSessionActionDetails> = {}): void {
    this.handlers.get(action)?.({ action, ...details } as MediaSessionActionDetails);
  }
}

function setup() {
  const harness = createHarness();
  const session = new FakeSession();
  const visibility: { callback: (() => void) | null; hidden: boolean } = {
    callback: null,
    hidden: false,
  };
  const dispose = attachMediaSession(harness.store, {
    session: session as unknown as MediaSessionLike,
    createMetadata: (init) => init as unknown as MediaMetadata,
    onVisibilityChange: (callback) => {
      visibility.callback = callback;
      return () => {
        visibility.callback = null;
      };
    },
    isHidden: () => visibility.hidden,
  });
  harness.store.load(makeDigest());
  harness.audio.loadMetadata(120);
  return { harness, session, dispose, visibility };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("media session", () => {
  it("sets the lock-screen metadata from the digest", () => {
    const { session } = setup();
    expect(session.metadata).toEqual({
      title: "Wednesday 7 October",
      artist: "Singularity",
      album: "October 2026",
      artwork: [
        { src: "/covers/a-512.png", sizes: "512x512", type: "image/png" },
        { src: "/covers/a-1024.png", sizes: "1024x1024", type: "image/png" },
      ],
    });
  });

  it("falls back to the long date when the title is empty", () => {
    const track = { digest: makeDigest({ title: "" }), timeline: null };
    expect(trackMetadata(track).title).toBe("Wednesday 7 October");
  });

  it("registers every handler the lock screen can use", () => {
    const { session } = setup();
    for (const action of [
      "play",
      "pause",
      "seekbackward",
      "seekforward",
      "seekto",
      "previoustrack",
      "nexttrack",
    ]) {
      expect(session.handlers.get(action)).toBeTypeOf("function");
    }
  });

  it("plays and pauses from the lock screen", () => {
    const { session, harness } = setup();
    session.fire("play");
    harness.audio.startPlaying();
    expect(harness.store.getState().status).toBe("playing");
    expect(session.playbackState).toBe("playing");
    session.fire("pause");
    expect(harness.store.getState().status).toBe("paused");
    expect(session.playbackState).toBe("paused");
  });

  it("skips back ten seconds and forward thirty, as the transport's buttons do", () => {
    expect(SKIP_BACK_SECONDS).toBe(10);
    expect(SKIP_FORWARD_SECONDS).toBe(30);
    const { session, harness } = setup();
    harness.store.seekTo(60_000);
    session.fire("seekbackward");
    expect(harness.store.getTime()).toBe(50);
    session.fire("seekforward");
    expect(harness.store.getTime()).toBe(80);
  });

  it("seeks by the offset the system sends when it sends one", () => {
    const { session, harness } = setup();
    harness.store.seekTo(60_000);
    session.fire("seekforward", { seekOffset: 15 });
    expect(harness.store.getTime()).toBe(75);
    session.fire("seekbackward", { seekOffset: 5 });
    expect(harness.store.getTime()).toBe(70);
    session.fire("seekto", { seekTime: 100 });
    expect(harness.store.getTime()).toBe(100);
  });

  it("maps previous and next track to items", () => {
    const { session, harness } = setup();
    session.fire("nexttrack");
    expect(harness.store.getTime()).toBe(30);
    session.fire("nexttrack");
    expect(harness.store.getTime()).toBe(60);
    session.fire("previoustrack");
    expect(harness.store.getTime()).toBe(30);
  });

  it("keeps position state in sync and never reports a position past the duration", () => {
    const { session, harness } = setup();
    harness.store.seekTo(45_000);
    const last = session.positions.at(-1);
    expect(last).toEqual({ duration: 120, playbackRate: 1, position: 45 });
    harness.store.setRate(1.5);
    expect(session.positions.at(-1)).toMatchObject({ playbackRate: 1.5 });
    for (const position of session.positions) {
      if (position) expect(position.position ?? 0).toBeLessThanOrEqual(position.duration ?? 0);
    }
  });

  it("registers its handlers again when the page becomes visible", () => {
    const { session, visibility } = setup();
    session.handlers.set("play", null);
    visibility.hidden = true;
    visibility.callback?.();
    expect(session.handlers.get("play")).toBeNull();
    visibility.hidden = false;
    visibility.callback?.();
    expect(session.handlers.get("play")).toBeTypeOf("function");
  });

  it("clears the handlers, metadata and position when disposed", () => {
    const { session, dispose, visibility } = setup();
    dispose();
    expect(session.metadata).toBeNull();
    expect(session.playbackState).toBe("none");
    for (const handler of session.handlers.values()) expect(handler).toBeNull();
    expect(session.positions.at(-1)).toBeUndefined();
    expect(visibility.callback).toBeNull();
  });

  it("does nothing where Media Session does not exist", () => {
    const harness = createHarness();
    const dispose = attachMediaSession(harness.store, { session: null });
    expect(() => {
      harness.store.load(makeDigest());
      dispose();
    }).not.toThrow();
  });

  it("survives a browser that rejects an action name", () => {
    const harness = createHarness();
    const session = new FakeSession();
    session.setActionHandler = () => {
      throw new TypeError("unsupported action");
    };
    expect(() =>
      attachMediaSession(harness.store, {
        session: session as unknown as MediaSessionLike,
        createMetadata: (init) => init as unknown as MediaMetadata,
        onVisibilityChange: () => () => undefined,
      }),
    ).not.toThrow();
  });
});
