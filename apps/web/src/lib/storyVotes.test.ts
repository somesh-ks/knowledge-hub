import { describe, expect, it } from "vitest";
import {
  dueIn,
  emptyVotes,
  markSent,
  markUnsent,
  pendingOps,
  press,
  pressedOf,
  SEND_AFTER_MS,
  type StoryRef,
} from "./storyVotes";

const story = (id: string): StoryRef => ({
  story_id: id,
  url: `https://example.com/${id}`,
  headline: `Story ${id}`,
  topic: "design",
  source_id: "example",
});

describe("story votes", () => {
  it("excludes the other vote, clears on a second press, and sends only the final state", () => {
    let state = press(emptyVotes(), story("a"), "up", 1_000);
    state = press(state, story("a"), "down", 2_000);
    expect(pressedOf(state, "a")).toBe("down");
    expect(pendingOps(state)).toHaveLength(1);
    expect(pendingOps(state)[0]?.votes).toHaveLength(1);
    state = press(state, story("a"), "down", 3_000);
    expect(pressedOf(state, "a")).toBeNull();
    expect(pendingOps(state)[0]?.votes[0]?.value).toBe("clear");
  });

  it("waits ten minutes from the first unsent vote, not from the latest", () => {
    let state = press(emptyVotes(), story("a"), "up", 1_000);
    state = press(state, story("b"), "up", 500_000);
    expect(dueIn(state, 1_000)).toBe(SEND_AFTER_MS);
    expect(dueIn(state, 1_000 + SEND_AFTER_MS)).toBe(0);
  });

  it("puts a refused batch back, and keeps a vote pressed again while it was on its way", () => {
    let state = press(emptyVotes(), story("a"), "up", 1_000);
    const [op] = pendingOps(state);
    const sent = op as NonNullable<typeof op>;
    state = markSent(state, sent);
    expect(pendingOps(state)).toHaveLength(0);
    state = markUnsent(state, sent);
    expect(pendingOps(state)[0]?.votes[0]?.value).toBe("up");

    state = markSent(state, sent);
    state = press(state, story("a"), "up", 2_000);
    state = markSent(state, sent);
    expect(pendingOps(state)[0]?.votes[0]?.value).toBe("clear");
  });

  it("splits votes into ops of fifteen", () => {
    let state = emptyVotes();
    for (let i = 0; i < 120; i += 1) state = press(state, story(`s${i}`), "up", 1_000 + i);
    expect(pendingOps(state).map((op) => op.votes.length)).toEqual([
      15, 15, 15, 15, 15, 15, 15, 15,
    ]);
  });
});
