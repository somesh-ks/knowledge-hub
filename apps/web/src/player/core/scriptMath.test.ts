import { describe, expect, it } from "vitest";
import type { PlayerTurn } from "../../types/contracts";
import { currentTurnIndex } from "./scriptMath";

const turn = (start: number | null, end: number | null): PlayerTurn => ({
  key: "t",
  speaker: "a",
  text: "x",
  start_ms: start,
  end_ms: end,
});

describe("currentTurnIndex", () => {
  const turns = [turn(0, 4_000), turn(4_000, 9_000), turn(9_000, 12_000)];

  it("finds the turn being spoken", () => {
    expect(currentTurnIndex(turns, 0)).toBe(0);
    expect(currentTurnIndex(turns, 3.9)).toBe(0);
    expect(currentTurnIndex(turns, 4)).toBe(1);
    expect(currentTurnIndex(turns, 100)).toBe(2);
  });

  it("is -1 when nothing is placed yet", () => {
    expect(currentTurnIndex([turn(null, null), turn(null, null)], 5)).toBe(-1);
    expect(currentTurnIndex([], 5)).toBe(-1);
  });
});
