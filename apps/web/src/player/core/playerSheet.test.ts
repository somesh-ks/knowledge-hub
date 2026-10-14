import { describe, expect, it, vi } from "vitest";
import type { SurfaceController } from "./sheetController";

// The motion loads after first paint. A press on the bar before it has loaded must still open the
// player, after the calls made before it and in their order, and nothing must load on a close.
const { calls, created } = vi.hoisted(() => {
  const calls: string[] = [];
  const created = vi.fn(
    (): SurfaceController => ({
      expand: () => calls.push("expand"),
      collapse: async () => void calls.push("collapse"),
      collapseNow: () => calls.push("collapseNow"),
      toggle: () => calls.push("toggle"),
      pointerDown: () => calls.push("pointerDown"),
      pointerMove: () => calls.push("pointerMove"),
      pointerEnd: () => calls.push("pointerEnd"),
      click: () => calls.push("click"),
      sync: () => calls.push("sync"),
      getSnapshot: () => ({ state: "expanding", open: true, landed: false }),
      getProgress: () => 0.5,
      subscribe: () => () => undefined,
    }),
  );
  return { calls, created };
});
vi.mock("./playerSheetMotion", () => ({ createPlayerSheet: created }));

describe("the player sheet before its motion has loaded", () => {
  it("is closed at rest, loads nothing for a close or a passing pointer, and replays a press in order", async () => {
    const { playerSheet, loadPlayerSheet } = await import("./playerSheet");
    const input = { pointerId: 1, x: 0, y: 0, t: 0, zone: "dock" as const, touch: true };

    expect(playerSheet.getSnapshot().open).toBe(false);
    await playerSheet.collapse();
    playerSheet.collapseNow();
    playerSheet.pointerMove(input);
    expect(created).not.toHaveBeenCalled();

    playerSheet.pointerDown(input);
    playerSheet.pointerMove(input);
    playerSheet.pointerEnd(input, false);
    playerSheet.click({ t: 1, fromPointer: true });
    await loadPlayerSheet();
    await Promise.resolve();

    expect(created).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["sync", "pointerDown", "pointerMove", "pointerEnd", "click"]);
    expect(playerSheet.getSnapshot().open).toBe(true);
  });
});
