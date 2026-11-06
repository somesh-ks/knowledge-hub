import { describe, expect, it } from "vitest";
import { DELETED_KEY } from "../../lib/deletedEpisodes";
import { createPlayQueue } from "./playQueue";
import type { StorageLike } from "./resume";
import { keepPlaces, skipper, suggestNext } from "./suggested";

function storageOf(entries: Record<string, string>) {
  return {
    getItem: (key: string) => entries[key] ?? null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
}

// Newest first, as /timeline.json lists them.
const TIMELINE = ["ep-5", "ep-4", "ep-3", "ep-2", "ep-1"];

describe("suggested next item", () => {
  it("walks to the next older item, skipping what is deleted or played to the end", () => {
    const storage = storageOf({
      [DELETED_KEY]: JSON.stringify([{ id: "ep-3", at: Date.now() }]),
      "singularity:played:ep-2": "1",
    });
    const skip = skipper(storage, []);
    expect(suggestNext(TIMELINE, "ep-4", skip)).toEqual(["ep-1"]);
    // Heard again from a position of its own: it counts as unplayed.
    const again = skipper(
      storageOf({ "singularity:played:ep-3": "1", "singularity:resume:ep-3": "42" }),
      [],
    );
    expect(suggestNext(TIMELINE, "ep-4", again)).toEqual(["ep-3", "ep-2", "ep-1"]);
  });

  it("starts at the newest unplayed item after one the site does not list yet", () => {
    const skip = skipper(storageOf({ "singularity:played:ep-5": "1" }), []);
    expect(suggestNext(TIMELINE, "ep-new", skip)).toEqual(["ep-4", "ep-3", "ep-2", "ep-1"]);
  });

  it("offers nothing older than the oldest, and leaves out what is queued", () => {
    expect(suggestNext(TIMELINE, "ep-1", () => false)).toEqual([]);
    expect(suggestNext(TIMELINE, "ep-5", skipper(storageOf({}), ["ep-4"]), 2)).toEqual([
      "ep-3",
      "ep-2",
    ]);
  });

  it("does not suggest a podcast taken off the queue until it is queued again", () => {
    const values = new Map<string, string>();
    const storage: StorageLike = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => void values.set(key, value),
      removeItem: (key) => void values.delete(key),
    };
    const queue = createPlayQueue({ storage, getCurrentId: () => "ep-5" });
    queue.add("ep-4");
    queue.remove("ep-4");
    expect(suggestNext(TIMELINE, "ep-5", skipper(storage, queue.getIds()))).toEqual([
      "ep-3",
      "ep-2",
      "ep-1",
    ]);
    queue.add("ep-4");
    queue.remove("ep-3");
    queue.started("ep-3");
    expect(suggestNext(TIMELINE, "ep-5", skipper(storage, []))).toEqual(TIMELINE.slice(1));
  });

  it("adds a refill at the end, never above the suggestions already shown", () => {
    // ep-3 came back to the list (heard again from a position): it joins under ep-2 and ep-1.
    expect(keepPlaces(["ep-2", "ep-1"], ["ep-3", "ep-2", "ep-1"])).toEqual([
      "ep-2",
      "ep-1",
      "ep-3",
    ]);
    expect(keepPlaces(["ep-4", "ep-3"], ["ep-3", "ep-2"])).toEqual(["ep-3", "ep-2"]);
  });
});
