/**
 * Test doubles shared by the player's unit tests: a fake audio element with the events the store
 * listens to, a manual animation-frame queue, a digest fixture and an in-memory storage.
 * Nothing here touches the network or the DOM.
 */
import type { PlayerDigestData } from "../../types/contracts";
import { createPlayerStore, type PlayerStoreOptions } from "./playerStore";
import type { AudioLike, PlayerEvent } from "./playerTypes";
import type { StorageLike } from "./resume";

export class FakeAudio implements AudioLike {
  src = "";
  currentTime = 0;
  duration = Number.NaN;
  paused = true;
  ended = false;
  readyState = 0;
  error: { code: number; message?: string } | null = null;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  preservesPitch = false;
  webkitPreservesPitch = false;
  preload = "none";
  playCalls = 0;
  pauseCalls = 0;
  /** Set to an Error to make the next play() reject, the way a blocked autoplay does. */
  playRejection: Error | null = null;
  readonly log: string[] = [];
  private readonly handlers = new Map<string, Set<() => void>>();

  play(): Promise<void> {
    this.playCalls += 1;
    this.log.push("play");
    if (this.playRejection) {
      const rejection = this.playRejection;
      this.playRejection = null;
      return Promise.reject(rejection);
    }
    this.paused = false;
    this.ended = false;
    return Promise.resolve();
  }

  pause(): void {
    this.pauseCalls += 1;
    this.log.push("pause");
    this.paused = true;
  }

  load(): void {
    this.readyState = 0;
  }

  removeAttribute(name: string): void {
    if (name === "src") this.src = "";
  }

  addEventListener(type: string, listener: () => void): void {
    const set = this.handlers.get(type) ?? new Set();
    set.add(listener);
    this.handlers.set(type, set);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.handlers.get(type)?.delete(listener);
  }

  emit(type: string): void {
    for (const listener of [...(this.handlers.get(type) ?? [])]) listener();
  }

  listenerCount(): number {
    let total = 0;
    for (const set of this.handlers.values()) total += set.size;
    return total;
  }

  /** The browser has read the header: duration is known and seeking works. */
  loadMetadata(durationSeconds: number): void {
    this.duration = durationSeconds;
    this.readyState = 1;
    this.emit("loadedmetadata");
    this.emit("durationchange");
  }

  /** What a real element does a moment after play() resolves. */
  startPlaying(): void {
    this.paused = false;
    this.readyState = 4;
    this.emit("playing");
  }

  finish(): void {
    this.ended = true;
    this.paused = true;
    this.emit("ended");
  }
}

export class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();
  throwOnWrite = false;

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.throwOnWrite) throw new Error("QuotaExceededError");
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

/** Four items over 120 seconds in three sections, with a previous digest to offer. */
export function makeDigest(overrides: Partial<PlayerDigestData> = {}): PlayerDigestData {
  return {
    id: "2026-10-07",
    date: "2026-10-07",
    title: "Wednesday 7 October",
    kind: "regular",
    audio: { url: "/audio/2026-10-07.mp3", duration_ms: 120_000 },
    timeline: "marks",
    items: [
      item("a1b2c3d4e5f6", "Springs that keep their velocity", "top", 0, 30_000),
      item("b1b2c3d4e5f6", "The safe triangle, rebuilt", "ui-craft", 30_000, 60_000),
      item("c1b2c3d4e5f6", "A small model for tool routing", "ai", 60_000, 90_000),
      item("d1b2c3d4e5f6", "Measuring agent interruptions", "ai", 90_000, 120_000),
    ],
    sections: [
      { slug: "top", title: "Top picks", start_ms: 0 },
      { slug: "ui-craft", title: "Interaction craft", start_ms: 30_000 },
      { slug: "ai", title: "AI models and products", start_ms: 60_000 },
    ],
    cover: {
      src512: "/covers/a-512.webp",
      src1024: "/covers/a-1024.webp",
      key: "oklch(74% 0.13 330)",
    },
    prev_id: "2026-10-05",
    next_id: null,
    ...overrides,
  };
}

function item(
  id: string,
  headline: string,
  section: PlayerDigestData["items"][number]["section"],
  start: number | null,
  end: number | null,
): PlayerDigestData["items"][number] {
  return { id, headline, section, source: "Interface Details", start_ms: start, end_ms: end };
}

export function makeDigestWithoutAudio(): PlayerDigestData {
  return makeDigest({
    id: "2026-10-09",
    date: "2026-10-09",
    audio: null,
    timeline: null,
    items: makeDigest().items.map((entry) => ({ ...entry, start_ms: null, end_ms: null })),
    sections: makeDigest().sections.map((section) => ({ ...section, start_ms: null })),
  });
}

export interface Harness {
  store: ReturnType<typeof createPlayerStore>;
  audio: FakeAudio;
  storage: MemoryStorage;
  events: PlayerEvent[];
  /** Runs the animation frames queued so far, once. */
  flushFrames(count?: number): void;
  clock: { now: number };
  createdAudios: FakeAudio[];
  rateChanges: number[];
}

export function createHarness(overrides: Partial<PlayerStoreOptions> = {}): Harness {
  const audio = new FakeAudio();
  const createdAudios: FakeAudio[] = [];
  const storage = new MemoryStorage();
  const clock = { now: 1_000 };
  const frames = new Map<number, () => void>();
  let nextHandle = 1;
  const rateChanges: number[] = [];
  const store = createPlayerStore({
    createAudio: () => {
      createdAudios.push(audio);
      return audio;
    },
    storage,
    now: () => clock.now,
    requestFrame: (callback) => {
      const handle = nextHandle++;
      frames.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => {
      frames.delete(handle);
    },
    isHidden: () => false,
    isOnline: () => true,
    onRateChange: (rate) => {
      rateChanges.push(rate);
    },
    ...overrides,
  });
  const events: PlayerEvent[] = [];
  store.onEvent((event) => events.push(event));
  return {
    store,
    audio,
    storage,
    events,
    clock,
    createdAudios,
    rateChanges,
    flushFrames(count = 1) {
      for (let index = 0; index < count; index += 1) {
        const queued = [...frames.entries()];
        frames.clear();
        for (const [, callback] of queued) callback();
      }
    },
  };
}
