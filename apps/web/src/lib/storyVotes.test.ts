import { describe, expect, it } from "vitest";
import { parseConfigOp, parseConfigRequest } from "../server/configEdit";
import {
  type BlockOp,
  dueIn,
  emptyVotes,
  HEADLINE_MAX,
  markSent,
  markUnsent,
  nextRequest,
  OPENS_WAIT_MS,
  pendingOps,
  press,
  pressedOf,
  recordOpen,
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

  // Every save is a commit and a redeploy: an open sent on its own each time a page was left would
  // cost one per visit, for a signal weaker than a vote.
  it("holds opens for a vote to ride with, or a day, and puts a refused one back", () => {
    let state = recordOpen(emptyVotes(), story("a"), 1_000);
    expect(pendingOps(state, 1_000 + OPENS_WAIT_MS - 1)).toHaveLength(0);
    expect(dueIn(state, 1_000)).toBe(OPENS_WAIT_MS);
    state = press(state, story("b"), "up", 2_000);
    const [op] = pendingOps(state, 2_000);
    expect(op?.opens?.map((open) => open.story_id)).toEqual(["a"]);
    const sent = op as NonNullable<typeof op>;
    state = markSent(state, sent);
    expect(pendingOps(state, 1_000 + OPENS_WAIT_MS)).toHaveLength(0);
    state = markUnsent(state, sent);
    expect(pendingOps(state, 1_000 + OPENS_WAIT_MS)[0]?.opens).toHaveLength(1);
    expect(parseConfigOp(sent)).not.toBeNull();
  });

  // A batch of long headlines and addresses was once over the server's body limit: refused as
  // invalid every ten minutes, it held every later vote back with it.
  it("packs every waiting vote and block into requests the server accepts", () => {
    let state = emptyVotes();
    for (let i = 0; i < 120; i += 1) {
      const long = { ...story(`s${i}`), url: `https://example.com/${"a".repeat(300)}/${i}` };
      state = press(state, { ...long, headline: "H".repeat(HEADLINE_MAX) }, "up", 1_000 + i);
    }
    let votes = pendingOps(state);
    let blocks: BlockOp[] = [{ op: "profile.block", domain: "reveneau.com" }];
    const carried = new Set<string>();
    while (votes.length + blocks.length > 0) {
      const ops = nextRequest(blocks, votes);
      const parsed = parseConfigRequest(JSON.stringify({ passphrase: "open", op: ops }));
      expect(parsed).not.toBeNull();
      for (const op of ops)
        if (op.op === "profile.vote") for (const vote of op.votes) carried.add(vote.story_id);
      blocks = blocks.filter((op) => !ops.includes(op));
      votes = votes.filter((op) => !ops.includes(op));
    }
    expect(carried.size).toBe(120);
  });
});
