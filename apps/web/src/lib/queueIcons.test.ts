import { describe, expect, it } from "vitest";
import { QUEUE_ACTION_ICONS, QUEUE_STATUS_ICONS } from "./queueIcons";

// Owner, 2026-11-05: a cancelled run showed an X at the start of its row and another at its end, because
// the status glyph for Cancelled was Close, the glyph of the action at the end. A state that shares a
// glyph with an action reads as that action.
describe("the queue's glyphs", () => {
  it("never draws a state with an action's glyph", () => {
    const actions = new Set<string>(Object.values(QUEUE_ACTION_ICONS));
    for (const [state, glyph] of Object.entries(QUEUE_STATUS_ICONS)) {
      expect(actions.has(glyph), `${state} is drawn with ${glyph}, an action's glyph`).toBe(false);
    }
  });

  it("gives each state a glyph of its own", () => {
    const glyphs = Object.values(QUEUE_STATUS_ICONS);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });
});
