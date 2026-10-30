import { describe, expect, it } from "vitest";
import type { FlagRow } from "./experimentsApi";
import { intended, PENDING_SECONDS, parsePending, unsettled } from "./pendingFlags";

const row = (id: string, enabled: boolean, promoted_at: number | null = null): FlagRow => ({
  id,
  enabled,
  promoted_at,
});
const NOW = 1_000_000;

// 2026-10-30: a switch pressed and the page reloaded at once showed the old state, because the
// reload read the store before the write had landed; the next reload showed the change.
describe("a switch written just before a reload", () => {
  const pending = { community: { flag: intended(row("community", false), "on", NOW), at: NOW } };

  it("is kept while the store still answers the old state", () => {
    const stored = [row("community", false)];
    expect(unsettled(stored, pending, NOW + 1_000)).toEqual(pending);
  });

  it("lets go once the store has it", () => {
    const stored = [row("community", true)];
    expect(unsettled(stored, pending, NOW + 2_000)).toEqual({});
  });

  it("gives up after the window, so a write that never landed does not stay on screen", () => {
    const late = NOW + (PENDING_SECONDS + 1) * 1000;
    const stored = [row("community", false)];
    expect(unsettled(stored, pending, late)).toEqual({});
  });

  it("keeps a promotion apart from the switch", () => {
    const promote = {
      community: { flag: intended(row("community", false), "promote", NOW), at: NOW },
    };
    expect(promote.community.flag.enabled).toBe(true);
    expect(promote.community.flag.promoted_at).toBe(NOW);
    const undone = intended(promote.community.flag, "unpromote", NOW);
    expect(undone).toEqual(row("community", true));
  });
});

describe("the change saved in the tab", () => {
  it("is read back as it was saved", () => {
    const saved = { community: { flag: row("community", true), at: NOW } };
    expect(parsePending(JSON.stringify(saved))).toEqual(saved);
  });

  it("is dropped when storage holds anything else, so the page still loads", () => {
    const strange = [null, "", "null", "[]", "3", "{", '{"a":{"flag":1,"at":"x"}}', '{"a":null}'];
    for (const text of strange) expect(parsePending(text)).toEqual({});
  });
});
