import { describe, expect, it } from "vitest";
import { DELETED_KEY } from "../../lib/deletedEpisodes";
import { skipper, suggestNext } from "./suggested";

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
});
