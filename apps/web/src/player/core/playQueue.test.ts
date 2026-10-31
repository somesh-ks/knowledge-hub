import { describe, expect, it } from "vitest";
import {
  addToQueue,
  createPlayQueue,
  HISTORY_KEY,
  moveInQueue,
  parseQueue,
  QUEUE_KEY,
  startItem,
  takeNext,
} from "./playQueue";
import type { StorageLike } from "./resume";

function memoryStorage(initial: Record<string, string> = {}): StorageLike {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

describe("the play queue", () => {
  it("never holds an item twice, nor the one playing now", () => {
    expect(addToQueue(["2026-10-05"], "2026-10-05", null)).toEqual(["2026-10-05"]);
    expect(addToQueue([], "ep-20261007-1930", "ep-20261007-1930")).toEqual([]);
    expect(addToQueue(["2026-10-05"], "ep-20261007-1930", "2026-10-07")).toEqual([
      "2026-10-05",
      "ep-20261007-1930",
    ]);
  });

  it("takes the first item still to come when one ends", () => {
    expect(takeNext(["2026-10-05", "ep-1"], "2026-10-07")).toEqual({
      next: "2026-10-05",
      rest: ["ep-1"],
    });
    // The one that just played is skipped if it was still listed.
    expect(takeNext(["2026-10-07", "ep-1"], "2026-10-07")).toEqual({ next: "ep-1", rest: [] });
    expect(takeNext([], "2026-10-07")).toEqual({ next: null, rest: [] });
  });

  it("moves an item to another place and keeps the others in order", () => {
    const ids = ["a", "b", "c", "d"];
    expect(moveInQueue(ids, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveInQueue(ids, 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveInQueue(ids, 1, 9)).toEqual(["a", "c", "d", "b"]);
    expect(moveInQueue(ids, 9, 0)).toEqual(ids);
  });

  it("reads back only a list of distinct ids from storage", () => {
    expect(parseQueue('["2026-10-05","ep-20261007-1930","2026-10-05"]')).toEqual([
      "2026-10-05",
      "ep-20261007-1930",
    ]);
    expect(parseQueue('["../x", 3, null]')).toEqual([]);
    expect(parseQueue("{")).toEqual([]);
    expect(parseQueue('{"ids":[]}')).toEqual([]);
    expect(parseQueue(null)).toEqual([]);
  });

  it("survives a reload, reordered, and tells the page after every change", () => {
    const storage = memoryStorage();
    const told: string[][] = [];
    const first = createPlayQueue({
      storage,
      getCurrentId: () => "2026-10-07",
      onChange: (ids) => told.push([...ids]),
    });
    first.add("2026-10-05");
    first.add("ep-20261007-1930");
    first.move(1, 0);
    const reloaded = createPlayQueue({ storage, getCurrentId: () => null });
    expect(reloaded.getIds()).toEqual(["ep-20261007-1930", "2026-10-05"]);
    expect(told.at(-1)).toEqual(["ep-20261007-1930", "2026-10-05"]);
    expect(reloaded.shift(null)).toBe("ep-20261007-1930");
    reloaded.shift(null);
    expect(storage.getItem(QUEUE_KEY)).toBeNull();
  });

  // D277: the queue used to drop each item as it started, so a tap on the third item emptied the list.
  it("keeps what played, and a jump moves the pointer without losing an item", () => {
    const list = { played: ["a"], current: "b", upcoming: ["c", "d", "e"] };
    // Ahead to the third: the one playing and the ones skipped are behind it, in order.
    expect(startItem(list, "e")).toEqual({
      played: ["a", "b", "c", "d"],
      current: "e",
      upcoming: [],
    });
    // Back to a played item: what followed it is to come again, ahead of the rest.
    const later = { played: ["a", "b", "c"], current: "d", upcoming: ["e"] };
    expect(startItem(later, "b")).toEqual({
      played: ["a"],
      current: "b",
      upcoming: ["c", "d", "e"],
    });
    // Queued again after a reload, then started: it is playing, not also to come.
    expect(startItem({ played: [], current: "a", upcoming: ["a", "b"] }, "a")).toEqual({
      played: [],
      current: "a",
      upcoming: ["b"],
    });
    // The item that was current, queued again after a reload, then another item started: listed once.
    expect(startItem({ played: [], current: "a", upcoming: ["a", "b"] }, "b")).toEqual({
      played: ["a"],
      current: "b",
      upcoming: [],
    });
    // Something the list never held (a page's Play) becomes current beside it.
    expect(startItem(list, "z")).toEqual({
      played: ["a", "b"],
      current: "z",
      upcoming: ["c", "d", "e"],
    });
  });

  it("keeps the played items across a reload, and the queue key holds only what is to come", () => {
    const storage = memoryStorage();
    const queue = createPlayQueue({ storage, getCurrentId: () => null });
    for (const id of ["a", "b", "c"]) queue.add(id);
    queue.started("a");
    queue.started("c");
    expect(storage.getItem(QUEUE_KEY)).toBeNull();
    const reloaded = createPlayQueue({ storage, getCurrentId: () => null });
    expect(reloaded.getView()).toEqual({ played: ["a", "b"], current: "c", upcoming: [] });
    expect(storage.getItem(HISTORY_KEY)).not.toBeNull();
  });
});
