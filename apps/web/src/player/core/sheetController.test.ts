import { describe, expect, it } from "vitest";
import type { CoverMorph } from "./coverMorph";
import {
  createSurfaceController,
  type GestureZone,
  type PointerInput,
  type SurfaceSnapshot,
  type SurfaceView,
} from "./sheetController";

const DISTANCE = 800;

/** A view that records what it was told, with nothing behind it. */
class FakeView implements SurfaceView {
  present = true;
  measures = 0;
  scroll = 0;
  readonly rendered: number[] = [];
  readonly applied: SurfaceSnapshot[] = [];
  readonly rests: string[] = [];
  readonly log: string[] = [];
  readonly captured = new Set<number>();
  /** Every flight written, in order: one per departure from rest. */
  readonly morphs: Array<CoverMorph | null> = [];
  escape: (() => void) | null = null;

  isPresent(): boolean {
    return this.present;
  }

  measure() {
    this.measures += 1;
    return {
      distance: DISTANCE,
      morph: { fromX: 8, fromY: 792, toX: 32, toY: 150 - this.scroll, size: 352, scale: 0.125 },
    };
  }

  setMorph(morph: CoverMorph | null): void {
    this.morphs.push(morph);
  }

  render(p: number): void {
    this.rendered.push(p);
  }

  apply(snapshot: SurfaceSnapshot): void {
    this.applied.push({ ...snapshot });
  }

  rest(state: "collapsed" | "expanded"): void {
    this.rests.push(state);
    if (state === "collapsed") this.scroll = 0;
  }

  enterModal(onEscape: () => void): void {
    this.escape = onEscape;
    this.log.push("enter");
  }

  leaveModal(): void {
    this.escape = null;
    this.log.push("leave");
  }

  capturePointer(pointerId: number): void {
    this.captured.add(pointerId);
  }

  releasePointer(pointerId: number): void {
    this.captured.delete(pointerId);
  }

  scrollTop(): number {
    return this.scroll;
  }

  scrollTo(top: number): void {
    this.scroll = Math.max(0, top);
    this.log.push(`scroll:${Math.round(this.scroll)}`);
  }
}

function setup(overrides: { reducedMotion?: boolean } = {}) {
  const view = new FakeView();
  const frames = new Map<number, (timestamp: number) => void>();
  let handle = 0;
  let now = 0;
  const cues: string[] = [];
  const root = new Map<string, string>();
  const surface = createSurfaceController({
    view,
    reducedMotion: () => overrides.reducedMotion ?? false,
    thresholds: () => ({ distance: 0.35, velocity: 0.5 }),
    fadeMs: () => 200,
    releaseBounce: () => 0.15,
    setRootAttribute: (name, value) => root.set(name, value),
    onCommitOpen: () => cues.push("open"),
    onCommitClose: () => cues.push("close"),
    requestFrame: (callback) => {
      handle += 1;
      frames.set(handle, callback);
      return handle;
    },
    cancelFrame: (id) => {
      frames.delete(id);
    },
  });
  /** Runs animation frames for this many milliseconds, 16 at a time. */
  const run = (ms: number): void => {
    for (let elapsed = 0; elapsed < ms; elapsed += 16) {
      now += 16;
      const queued = [...frames.entries()];
      frames.clear();
      for (const [, callback] of queued) callback(now);
    }
  };
  /** Runs frames until nothing is animating. */
  const settle = (): void => {
    for (let guard = 0; guard < 400 && frames.size > 0; guard += 1) run(16);
  };
  const state = (): string => surface.getSnapshot().state;
  return { surface, view, cues, root, run, settle, state, pending: () => frames.size };
}

let clock = 1_000;
function at(
  zone: GestureZone,
  y: number,
  t: number,
  extra: Partial<PointerInput> = {},
): PointerInput {
  return { pointerId: 1, x: 100, y, t, zone, touch: true, ...extra };
}

/** A press and a lift in the same place, 60 ms apart. */
function tap(
  surface: ReturnType<typeof setup>["surface"],
  zone: GestureZone,
  t: number,
  y = 780,
): void {
  surface.pointerDown(at(zone, y, t));
  surface.pointerEnd(at(zone, y, t + 60), false);
}

/** A straight drag in `steps` moves over `ms`, without the lift. */
function drag(
  surface: ReturnType<typeof setup>["surface"],
  zone: GestureZone,
  fromY: number,
  toY: number,
  ms: number,
  steps = 10,
): number {
  clock += 1_000;
  const start = clock;
  surface.pointerDown(at(zone, fromY, start));
  for (let step = 1; step <= steps; step += 1) {
    surface.pointerMove(
      at(zone, fromY + ((toY - fromY) * step) / steps, start + (ms * step) / steps),
    );
  }
  return start + ms;
}

describe("expanding and collapsing", () => {
  it("commits at once on expand and comes to rest expanded", () => {
    const { surface, view, cues, root, settle, state } = setup();
    expect(state()).toBe("collapsed");
    surface.expand();
    expect(state()).toBe("expanding");
    // The commit does not wait for the spring: the document is the player's from the first frame.
    expect(surface.getSnapshot().open).toBe(true);
    expect(root.get("data-player")).toBe("open");
    expect(view.log).toEqual(["enter"]);
    expect(cues).toEqual(["open"]);
    settle();
    expect(state()).toBe("expanded");
    expect(surface.getProgress()).toBe(1);
    expect(view.rests).toEqual(["expanded"]);
    expect(view.rendered.at(-1)).toBe(1);
  });

  it("makes the page reachable before it asks for focus", () => {
    const { surface, view } = setup();
    surface.expand();
    // enterModal focuses the page, so the state that lifts `inert` has to be applied first.
    const firstNotCollapsed = view.applied.findIndex((snapshot) => snapshot.state !== "collapsed");
    expect(firstNotCollapsed).toBeGreaterThanOrEqual(0);
    expect(view.applied.at(-1)).toMatchObject({ state: "expanding", open: true });
  });

  it("gives the document back at once on collapse and resolves when it rests", async () => {
    const { surface, view, cues, root, settle, state } = setup();
    surface.expand();
    settle();
    let resolved = false;
    const done = surface.collapse().then(() => {
      resolved = true;
    });
    expect(state()).toBe("collapsing");
    expect(surface.getSnapshot().open).toBe(false);
    expect(root.get("data-player")).toBe("closed");
    expect(view.log).toEqual(["enter", "leave"]);
    expect(cues).toEqual(["open", "close"]);
    await Promise.resolve();
    expect(resolved).toBe(false);
    settle();
    await done;
    expect(state()).toBe("collapsed");
    expect(surface.getProgress()).toBe(0);
    expect(view.rests).toEqual(["expanded", "collapsed"]);
  });

  it("resolves a collapse straight away when it is already collapsed", async () => {
    const { surface, cues, pending } = setup();
    await surface.collapse();
    expect(cues).toEqual([]);
    expect(pending()).toBe(0);
  });

  it("retargets a collapse that is under way when asked to expand, and lets the waiter go", async () => {
    const { surface, view, run, settle, state } = setup();
    surface.expand();
    settle();
    const done = surface.collapse();
    run(80);
    const midway = surface.getProgress();
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(1);
    surface.expand();
    expect(state()).toBe("expanding");
    await done;
    // It carried on from where it was: no frame jumped back to the start.
    run(16);
    expect(surface.getProgress()).toBeGreaterThan(midway - 0.05);
    settle();
    expect(state()).toBe("expanded");
    expect(view.log).toEqual(["enter", "leave", "enter"]);
  });

  it("collapses now without a sound, in one step", async () => {
    const { surface, view, cues, root, run, state, pending } = setup();
    surface.expand();
    run(100);
    const waiting = surface.collapse();
    surface.expand();
    await waiting;
    cues.length = 0;
    surface.collapseNow();
    expect(state()).toBe("collapsed");
    expect(surface.getProgress()).toBe(0);
    expect(surface.getSnapshot().open).toBe(false);
    expect(root.get("data-player")).toBe("closed");
    expect(view.rests.at(-1)).toBe("collapsed");
    expect(view.log.at(-1)).toBe("leave");
    expect(pending()).toBe(0);
    // A navigation is not the listener closing the player: no cue.
    expect(cues).toEqual([]);
  });

  it("measures once each time it leaves rest, never mid-flight", () => {
    const { surface, view, run, settle } = setup();
    surface.expand();
    expect(view.measures).toBe(1);
    run(60);
    void surface.collapse();
    surface.expand();
    expect(view.measures).toBe(1);
    settle();
    void surface.collapse();
    expect(view.measures).toBe(2);
  });

  it("writes the cover's flight once per departure from rest, from what it measured", () => {
    const { surface, view, run, settle } = setup();
    surface.expand();
    expect(view.morphs).toHaveLength(1);
    expect(view.morphs[0]).toMatchObject({ fromY: 792, toY: 150 });
    // Turned round mid-flight, the cover keeps the flight it has: no second measure, no jump.
    run(60);
    void surface.collapse();
    surface.expand();
    expect(view.morphs).toHaveLength(1);
    settle();
    // Closed from a scrolled page, the flight leaves from where the page shows its cover.
    view.scroll = 120;
    void surface.collapse();
    expect(view.morphs).toHaveLength(2);
    expect(view.morphs[1]).toMatchObject({ fromY: 792, toY: 30 });
  });

  it("measures the flight before a drag moves anything, and draws its first frame from it", () => {
    const { surface, view } = setup();
    clock += 10_000;
    const t = clock;
    surface.pointerDown(at("dock", 780, t));
    surface.pointerMove(at("dock", 760, t + 16));
    expect(view.morphs).toHaveLength(1);
    expect(view.rendered).toHaveLength(1);
    // The drag took hold at the slop's edge: its first frame is the finger's own travel past it.
    expect(view.rendered[0]).toBeCloseTo(8 / DISTANCE, 10);
  });

  it("does nothing when the surface is not in the document", async () => {
    const { surface, view, cues, state, pending } = setup();
    view.present = false;
    surface.expand();
    expect(state()).toBe("collapsed");
    expect(cues).toEqual([]);
    expect(pending()).toBe(0);
    await surface.collapse();
  });

  it("fades over the state duration when motion is reduced", () => {
    const { surface, run, state } = setup({ reducedMotion: true });
    surface.expand();
    run(120);
    expect(state()).toBe("expanding");
    run(120);
    expect(state()).toBe("expanded");
  });

  it("lets the page take presses as soon as it has landed, before the spring's tail ends", () => {
    const { surface, run, state } = setup();
    surface.expand();
    expect(surface.getSnapshot().landed).toBe(false);
    run(360);
    expect(state()).toBe("expanding");
    expect(surface.getProgress()).toBeGreaterThan(0.98);
    expect(surface.getSnapshot().landed).toBe(true);
    void surface.collapse();
    expect(surface.getSnapshot().landed).toBe(false);
  });

  it("applies the current state again when asked to sync", () => {
    const { surface, view, settle } = setup();
    surface.expand();
    settle();
    view.applied.length = 0;
    surface.sync();
    expect(view.applied).toEqual([{ state: "expanded", open: true, landed: true }]);
  });

  it("writes the root attribute on sync, for a page that never carried it", () => {
    const { surface, root } = setup();
    expect(root.has("data-player")).toBe(false);
    surface.sync();
    expect(root.get("data-player")).toBe("closed");
  });

  it("tells subscribers about every change of state", () => {
    const { surface, settle } = setup();
    const seen: string[] = [];
    const off = surface.subscribe(() => seen.push(surface.getSnapshot().state));
    surface.expand();
    settle();
    off();
    void surface.collapse();
    expect(seen).toContain("expanding");
    expect(seen.at(-1)).toBe("expanded");
  });
});

describe("taps", () => {
  it("opens from a tap on the bar", () => {
    const { surface, settle, state, cues } = setup();
    tap(surface, "dock", 1_000);
    expect(state()).toBe("expanding");
    settle();
    expect(state()).toBe("expanded");
    expect(cues).toEqual(["open"]);
  });

  it("ends expanded after two taps 120 ms apart", () => {
    const { surface, run, settle, state, cues } = setup();
    tap(surface, "dock", 1_000);
    run(120);
    // The second tap lands on whatever the rising page has put under the finger.
    tap(surface, "page", 1_120);
    expect(state()).toBe("expanding");
    settle();
    expect(state()).toBe("expanded");
    expect(cues).toEqual(["open"]);
  });

  it("never closes from a tap while it is moving, and reopens from a tap while it is closing", () => {
    const { surface, run, settle, state } = setup();
    surface.expand();
    run(100);
    tap(surface, "dock", 2_000);
    tap(surface, "drag", 2_100);
    expect(state()).toBe("expanding");
    settle();
    void surface.collapse();
    for (const delay of [100, 300]) {
      run(delay);
      tap(surface, delay === 100 ? "page" : "dock", 3_000 + delay);
      expect(state()).toBe("expanding");
      settle();
      expect(state()).toBe("expanded");
      void surface.collapse();
    }
  });

  it("closes from a tap on the bar only when the page is fully open", () => {
    const { surface, settle, state } = setup();
    surface.expand();
    settle();
    tap(surface, "dock", 5_000);
    expect(state()).toBe("collapsing");
  });

  it("opens from a sloppy tap that drifts up to the slop", () => {
    for (const drift of [10, 12]) {
      const { surface, settle, state } = setup();
      const end = drag(surface, "dock", 780, 780 - drift, 150, 5);
      expect(state()).toBe("collapsed");
      surface.pointerEnd(at("dock", 780 - drift, end), false);
      expect(state()).toBe("expanding");
      settle();
      expect(state()).toBe("expanded");
    }
  });

  it("leaves a long press to the browser's own click", () => {
    const { surface, state } = setup();
    surface.pointerDown(at("dock", 780, 1_000));
    surface.pointerEnd(at("dock", 780, 2_400), false);
    expect(state()).toBe("collapsed");
    // The click that follows a held mouse button is not swallowed.
    surface.click({ t: 2_410, fromPointer: true });
    expect(state()).toBe("expanding");
  });

  it("ignores taps on the open page, whose controls answer for themselves", () => {
    const { surface, settle, state } = setup();
    surface.expand();
    settle();
    tap(surface, "page", 4_000, 400);
    tap(surface, "drag", 4_200, 120);
    expect(state()).toBe("expanded");
    // Neither tap was marked as handled, so a click on the bar straight after still counts.
    surface.click({ t: 4_300, fromPointer: true });
    expect(state()).toBe("collapsing");
  });
});

describe("clicks on the bar", () => {
  it("drops the click a handled tap leaves behind, so one press is one action", () => {
    const { surface, settle, state, cues } = setup();
    tap(surface, "dock", 1_000);
    surface.click({ t: 1_070, fromPointer: true });
    settle();
    expect(state()).toBe("expanded");
    expect(cues).toEqual(["open"]);
  });

  it("drops the click that follows a drag", () => {
    const { surface, settle, state } = setup();
    const end = drag(surface, "dock", 780, 700, 400);
    surface.pointerEnd(at("dock", 700, end), false);
    surface.click({ t: end + 5, fromPointer: true });
    settle();
    expect(state()).toBe("collapsed");
  });

  it("always answers the keyboard, and a pointer click that nothing handled", () => {
    const { surface, settle, state } = setup();
    tap(surface, "dock", 1_000);
    settle();
    surface.click({ t: 1_080, fromPointer: false });
    expect(state()).toBe("collapsing");
    settle();
    // Long after any gesture, a click is just a click: the suppression cannot latch.
    surface.click({ t: 9_000, fromPointer: true });
    expect(state()).toBe("expanding");
  });
});

describe("dragging the page open", () => {
  it("follows the finger from the slop without committing, then opens on release", () => {
    const { surface, view, cues, settle, state } = setup();
    const end = drag(surface, "dock", 780, 380, 600);
    expect(state()).toBe("dragging");
    expect(view.captured.has(1)).toBe(true);
    expect(surface.getSnapshot().open).toBe(false);
    expect(cues).toEqual([]);
    // 400 px of travel, less the 12 px of slop, over 800 px.
    expect(surface.getProgress()).toBeCloseTo((400 - 12) / DISTANCE, 2);
    surface.pointerEnd(at("dock", 380, end + 200), false);
    expect(state()).toBe("expanding");
    expect(cues).toEqual(["open"]);
    expect(view.captured.has(1)).toBe(false);
    settle();
    expect(state()).toBe("expanded");
  });

  it("goes back down, silently, after a short slow pull", () => {
    const { surface, view, cues, settle, state } = setup();
    const end = drag(surface, "dock", 780, 720, 500);
    surface.pointerEnd(at("dock", 720, end + 150), false);
    expect(state()).toBe("collapsing");
    settle();
    expect(state()).toBe("collapsed");
    expect(cues).toEqual([]);
    expect(view.log).toEqual([]);
  });

  it("opens on a flick even when the finger travelled little", () => {
    const { surface, settle, state } = setup();
    const end = drag(surface, "dock", 780, 680, 60, 6);
    surface.pointerEnd(at("dock", 680, end), false);
    expect(state()).toBe("expanding");
    settle();
    expect(state()).toBe("expanded");
  });

  it("does not start from a pull down on the collapsed bar", () => {
    const { surface, view, state } = setup();
    const end = drag(surface, "dock", 780, 840, 200);
    expect(state()).toBe("collapsed");
    surface.pointerEnd(at("dock", 840, end), false);
    expect(state()).toBe("collapsed");
    expect(view.measures).toBe(0);
  });
});

describe("dragging the page closed", () => {
  function opened() {
    const made = setup();
    made.surface.expand();
    made.settle();
    made.cues.length = 0;
    made.view.log.length = 0;
    return made;
  }

  it("springs back after a slow, short drag, because release decides", () => {
    const { surface, cues, settle, state } = opened();
    const end = drag(surface, "drag", 120, 240, 400);
    expect(state()).toBe("dragging");
    expect(surface.getSnapshot().open).toBe(true);
    surface.pointerEnd(at("drag", 240, end + 200), false);
    expect(state()).toBe("expanding");
    settle();
    expect(state()).toBe("expanded");
    expect(cues).toEqual([]);
  });

  it("dismisses on release after a long drag, never before the lift", () => {
    const { surface, view, cues, settle, state } = opened();
    const end = drag(surface, "drag", 120, 620, 700);
    expect(state()).toBe("dragging");
    expect(surface.getSnapshot().open).toBe(true);
    expect(view.log).toEqual([]);
    surface.pointerEnd(at("drag", 620, end + 200), false);
    expect(state()).toBe("collapsing");
    expect(cues).toEqual(["close"]);
    settle();
    expect(state()).toBe("collapsed");
  });

  it("dismisses on a flick down", () => {
    const { surface, settle, state } = opened();
    const end = drag(surface, "drag", 120, 260, 70, 7);
    surface.pointerEnd(at("drag", 260, end), false);
    expect(state()).toBe("collapsing");
    settle();
    expect(state()).toBe("collapsed");
  });

  it("stays open when the finger comes most of the way back before lifting", () => {
    const { surface, settle, state } = opened();
    clock += 1_000;
    surface.pointerDown(at("drag", 120, clock));
    for (let step = 1; step <= 10; step += 1)
      surface.pointerMove(at("drag", 120 + step * 50, clock + step * 40));
    for (let step = 1; step <= 10; step += 1) {
      surface.pointerMove(at("drag", 620 - step * 46, clock + 400 + step * 40));
    }
    surface.pointerEnd(at("drag", 160, clock + 1_000), false);
    expect(state()).toBe("expanding");
    settle();
    expect(state()).toBe("expanded");
  });

  it("never pulls the page above fully open", () => {
    const { surface, view } = opened();
    view.rendered.length = 0;
    const end = drag(surface, "drag", 300, 100, 300);
    surface.pointerEnd(at("drag", 100, end), false);
    expect(Math.max(1, ...view.rendered)).toBe(1);
  });
});

describe("a grab while the page is moving", () => {
  it("decides on that gesture's own travel, so catching a rising page does not dismiss it", () => {
    const { surface, run, settle, state } = setup();
    surface.expand();
    run(60);
    const early = surface.getProgress();
    expect(early).toBeLessThan(0.5);
    // The page is at about a fifth of the way up. A small, slow nudge down is not a dismissal.
    const end = drag(surface, "page", 500, 530, 300);
    expect(state()).toBe("dragging");
    surface.pointerEnd(at("page", 530, end + 150), false);
    expect(state()).toBe("expanding");
    settle();
    expect(state()).toBe("expanded");
  });

  it("starts from the live value, without a jump", () => {
    const { surface, view, run } = setup();
    surface.expand();
    run(100);
    const live = surface.getProgress();
    clock += 1_000;
    surface.pointerDown(at("page", 500, clock));
    surface.pointerMove(at("page", 487, clock + 30));
    const first = view.rendered.at(-1) ?? 0;
    expect(Math.abs(first - surface.getProgress())).toBeLessThan(0.001);
    // One pixel past the slop moves the page by one pixel, from where it had got to.
    expect(Math.abs(surface.getProgress() - live)).toBeLessThan(0.08);
  });

  it("can still be thrown shut on purpose", () => {
    const { surface, run, settle, state } = setup();
    surface.expand();
    run(200);
    const end = drag(surface, "page", 300, 460, 70, 7);
    surface.pointerEnd(at("page", 460, end), false);
    expect(state()).toBe("collapsing");
    settle();
    expect(state()).toBe("collapsed");
  });
});

describe("gestures the system ends", () => {
  it("goes back where it was on a cancel, without a commit", () => {
    const { surface, cues, settle, state } = setup();
    const end = drag(surface, "dock", 780, 300, 500);
    surface.pointerEnd(at("dock", 300, end), true);
    expect(state()).toBe("collapsing");
    settle();
    expect(state()).toBe("collapsed");
    expect(cues).toEqual([]);
  });

  it("is not left mid-travel when capture is lost without a lift", () => {
    const { surface, view, settle, state } = setup();
    surface.expand();
    settle();
    drag(surface, "drag", 120, 400, 400);
    expect(state()).toBe("dragging");
    // lostpointercapture, and no pointerup ever arrives.
    surface.pointerEnd(at("drag", 400, clock + 500), true);
    expect(state()).not.toBe("dragging");
    settle();
    expect(state()).toBe("expanded");
    expect(view.captured.size).toBe(0);
  });

  it("ignores the lost-capture event that follows a normal lift", () => {
    const { surface, settle, state } = setup();
    surface.expand();
    settle();
    const end = drag(surface, "drag", 120, 620, 700);
    surface.pointerEnd(at("drag", 620, end + 200), false);
    expect(state()).toBe("collapsing");
    surface.pointerEnd(at("drag", 620, end + 201), true);
    expect(state()).toBe("collapsing");
  });

  it("ignores a second finger while one is down", () => {
    const { surface, state } = setup();
    drag(surface, "dock", 780, 500, 300);
    const before = surface.getProgress();
    surface.pointerDown(at("dock", 780, clock + 400, { pointerId: 2 }));
    surface.pointerMove(at("dock", 100, clock + 420, { pointerId: 2 }));
    surface.pointerEnd(at("dock", 100, clock + 440, { pointerId: 2 }), false);
    expect(state()).toBe("dragging");
    expect(surface.getProgress()).toBe(before);
  });

  it("takes a new gesture after one was cancelled", () => {
    const { surface, settle, state } = setup();
    const end = drag(surface, "dock", 780, 600, 300);
    surface.pointerEnd(at("dock", 600, end), true);
    settle();
    tap(surface, "dock", clock + 2_000);
    expect(state()).toBe("expanding");
  });
});

describe("the page's own scrolling", () => {
  function opened() {
    const made = setup();
    made.surface.expand();
    made.settle();
    made.view.log.length = 0;
    return made;
  }

  it("scrolls instead of dismissing when the page is not at the top", () => {
    const { surface, view, state } = opened();
    view.scroll = 120;
    const end = drag(surface, "drag", 100, 180, 300);
    expect(state()).toBe("expanded");
    // 80 px down, less the slop: the content came down with the finger.
    expect(view.scroll).toBeCloseTo(120 - (80 - 12), 0);
    surface.pointerEnd(at("drag", 180, end + 200), false);
    expect(state()).toBe("expanded");
  });

  it("scrolls on a pull up from the top, which is not a dismissal either", () => {
    const { surface, view, state } = opened();
    const end = drag(surface, "drag", 300, 200, 300);
    expect(state()).toBe("expanded");
    expect(view.scroll).toBeCloseTo(100 - 12, 0);
    surface.pointerEnd(at("drag", 200, end + 200), false);
    expect(state()).toBe("expanded");
  });

  it("carries a flick on for a moment after the lift", () => {
    const { surface, view, run } = opened();
    view.scroll = 0;
    const end = drag(surface, "drag", 400, 250, 80, 8);
    surface.pointerEnd(at("drag", 250, end), false);
    const atLift = view.scroll;
    run(300);
    expect(view.scroll).toBeGreaterThan(atLift + 20);
  });

  it("does neither with a mouse, which has a wheel", () => {
    const { surface, view, state } = opened();
    view.scroll = 120;
    clock += 1_000;
    surface.pointerDown(at("drag", 100, clock, { touch: false }));
    surface.pointerMove(at("drag", 180, clock + 100, { touch: false }));
    surface.pointerEnd(at("drag", 180, clock + 200, { touch: false }), false);
    expect(state()).toBe("expanded");
    expect(view.scroll).toBe(120);
  });

  it("still dismisses with a mouse from the top", () => {
    const { surface, state } = opened();
    clock += 1_000;
    surface.pointerDown(at("drag", 100, clock, { touch: false }));
    for (let step = 1; step <= 8; step += 1) {
      surface.pointerMove(at("drag", 100 + step * 60, clock + step * 60, { touch: false }));
    }
    expect(state()).toBe("dragging");
    surface.pointerEnd(at("drag", 580, clock + 700, { touch: false }), false);
    expect(state()).toBe("collapsing");
  });
});

describe("Escape", () => {
  it("closes the open page through the modal scope's listener", () => {
    const { surface, view, settle, state } = setup();
    surface.expand();
    settle();
    view.escape?.();
    expect(state()).toBe("collapsing");
  });
});
