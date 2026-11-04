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
    first.arrange(["ep-20261007-1930", "2026-10-05"]);
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
      above: [],
    });
    // Back to a played item: what followed it is to come again, ahead of the rest.
    const later = { played: ["a", "b", "c"], current: "d", upcoming: ["e"] };
    expect(startItem(later, "b")).toEqual({
      played: ["a"],
      current: "b",
      upcoming: ["c", "d", "e"],
      above: [],
    });
    // Queued again after a reload, then started: it is playing, not also to come.
    expect(startItem({ played: [], current: "a", upcoming: ["a", "b"] }, "a")).toEqual({
      played: [],
      current: "a",
      upcoming: ["b"],
      above: [],
    });
    // The item that was current, queued again after a reload, then another item started: listed once.
    expect(startItem({ played: [], current: "a", upcoming: ["a", "b"] }, "b")).toEqual({
      played: ["a"],
      current: "b",
      upcoming: [],
      above: [],
    });
    // Listed behind and ahead (the two storage keys disagree): the first place wins, so replaying it
    // puts what followed it back to come.
    expect(startItem({ played: ["a", "b"], current: "c", upcoming: ["a", "d"] }, "a")).toEqual({
      played: [],
      current: "a",
      upcoming: ["b", "c", "d"],
      above: [],
    });
    // Something the list never held (a page's Play) becomes current beside it.
    expect(startItem(list, "z")).toEqual({
      played: ["a", "b"],
      current: "z",
      upcoming: ["c", "d", "e"],
      above: [],
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
    expect(reloaded.getView()).toEqual({
      played: ["a", "b"],
      current: "c",
      upcoming: [],
      above: [],
    });
    expect(storage.getItem(HISTORY_KEY)).not.toBeNull();
  });

  // A swipe on the row that plays takes it off the list, not out of the audio (owner, 2026-11-03).
  it("drops the playing item from the list when it is removed, and keeps the rest", () => {
    const queue = createPlayQueue({ storage: memoryStorage(), getCurrentId: () => null });
    for (const id of ["a", "b", "c"]) queue.add(id);
    queue.started("b");
    queue.remove("b");
    expect(queue.getView()).toEqual({ played: ["a"], current: null, upcoming: ["c"], above: [] });
  });

  // D357 (owner, 2026-11-03: "I cannot put any other podcast above the currently playing podcast"):
  // the list plays top to bottom, so a row put above the playing one stays there and never starts by
  // itself, and the playing row dragged lower keeps the rows it passed listed above it (D349 dropped
  // them out of sight).
  it("keeps rows put above the playing one where they are, through starts, removals and a reload", () => {
    const storage = memoryStorage();
    const queue = createPlayQueue({ storage, getCurrentId: () => null });
    for (const id of ["a", "b", "c", "d"]) queue.add(id);
    queue.started("a");
    // d above the playing a; a dragged under b.
    queue.arrange(["d", "a", "b", "c"]);
    queue.arrange(["d", "b", "a", "c"]);
    expect(queue.getView()).toMatchObject({ above: ["d", "b"], current: "a", upcoming: ["c"] });
    // A foreign order is refused.
    queue.arrange(["d", "b", "a", "z"]);
    expect(queue.getView().upcoming).toEqual(["c"]);
    // a ends: what is under it plays, and the rows above stay where they were put.
    expect(queue.shift("a")).toBe("c");
    queue.started("c");
    expect(queue.getView()).toMatchObject({ above: ["d", "b"], current: "c", upcoming: [] });
    expect(createPlayQueue({ storage, getCurrentId: () => null }).getView().above).toEqual([
      "d",
      "b",
    ]);
    // Up to a row above: the order holds, and the rows under it are to come again.
    queue.started("d");
    expect(queue.getView()).toMatchObject({ above: [], current: "d", upcoming: ["b", "c"] });
    // The playing row removed: the rows above it head what is to come, in the order they had.
    queue.arrange(["b", "d", "c"]);
    queue.remove("d");
    expect(queue.getView()).toMatchObject({ above: [], current: null, upcoming: ["b", "c"] });
    // Queued again from a page, a row above comes down to be played.
    queue.started("c");
    queue.arrange(["b", "c"]);
    expect(queue.add("b")).toBe(true);
    expect(queue.getView()).toMatchObject({ above: [], current: "c", upcoming: ["b"] });
    // The playing one deleted on the device (deletedEpisodes.ts): a row lifted, then removed, stays gone.
    const left = memoryStorage({
      [HISTORY_KEY]: JSON.stringify({ played: [], current: null, above: ["a"] }),
    });
    createPlayQueue({ storage: left, getCurrentId: () => null }).remove("a");
    expect(createPlayQueue({ storage: left, getCurrentId: () => null }).getIds()).toEqual([]);
  });
});
